const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')

const { config, logger, redis } = require('../../config')
const { githubService } = require('../github')
const { parserService } = require('../parser')

const namespace = 'clippings-backend:crawler:worker'
const crawleeConfig = Configuration.getGlobalConfig()
crawleeConfig.set('logLevel', config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')

class CrawlerWorker extends EventEmitter {
    constructor() {
        super()
        this.emitter = new EventEmitter()
        this.emitter.on('error', error => {
            addSetItem('errors', JSON.stringify(error), 500)
        })
        this.emitter.on('crawled', async payload => {
            const { listingURL, html, imageUrls, listingPid } = payload

            // store data in git
            const gitUrl = await githubService.saveAdToPages({ url: listingURL, html, imageUrls })
            const recentListing = await toRecentListing(payload)
            await redis.HSET('archives', listingPid, JSON.stringify({
                createdAt: recentListing.createdAt,
                metadata: recentListing.metadata,
                ...payload
            }))
            addSetItem('recent_listings', JSON.stringify(recentListing), 10)
            this.emitter.emit('archived', { archived: { ...payload, gitUrl } })
        })
        this.crawlers = {}
    }
    async archive(options) {
        const { emitter, crawlers } = this
        const { listingURL, listingUUID, clientId } = options
        const isRunning = await redis.GET(`running-${listingUUID}`)

        if (!isRunning) {
            logger.debug({ namespace, message: 'crawling', listingUUID })
            // check to see if the user is at the maximum crawler limit first and wait for the next cycle, otherwise start a new crawl
            const userConfig = JSON.parse(await redis.HGET('userConfig', clientId))
            const numberOfCrawlers = await redis.ZSCORE(`crawlers`, clientId)

            await redis.SET(`running-${listingUUID}`, new Date().toLocaleString(), { EX: 30 })

            const multi = redis.multi()
            multi.HVALS(`queued`, clientId)
            multi.HKEYS(`queued`, clientId)
            const results = await multi.exec()
            const urls = Array.from(new Set([...results[0], `${listingUUID} ${listingURL}`])).filter(url => url)

            results[1].map(key => redis.HDEL(`queued`, key))

            if (!crawlers[clientId]) {
                crawlers[clientId] = await launchCrawler(emitter, clientId)
            } else if (!numberOfCrawlers || numberOfCrawlers < (userConfig?.crawlerLimit || 1)) {
                crawlers[clientId] = await launchCrawler(emitter, clientId)
            }
            run(crawlers[clientId], urls, options)
        } else {
            logger.debug({ namespace, message: `${new Date().toLocaleTimeString()}: queued clientId: ${clientId}` })
            redis.HSET(`queued`, clientId, `${listingUUID} ${listingURL}`)
        }
    }
}

module.exports = CrawlerWorker

async function addSetItem(setKey, item, maxSize) {
    const currentSize = await redis.SCARD(setKey)

    if (currentSize < maxSize) {
        await redis.SADD(setKey, item)
    } else {
        // Prune the Set by removing the first (oldest) member(s).
        const membersToRemove = currentSize - maxSize + 1
        for (let i = 0; i < membersToRemove; i++) {
            await redis.SPOP(setKey)
        }

        // Now, you can safely add the new item to the Set.
        await redis.SADD(setKey, item)
    }
}

async function toRecentListing(listing) {
    const { listingPid, html } = listing
    const metadata = await parserService.parseMetadata(html)

    return { listingPid, metadata, createdAt: Date.now() }
}
async function launchCrawler(emitter, clientId) {
    const crawler = new PlaywrightCrawler({
        launchContext: {
            useIncognitoPages: true,
            launchOptions: {
                args: [
                    '--no-zygote',
                    '--single-process',
                    '--remote-debugging-port=9222',
                    '--headless=new'
                ]
            }
        },
        browserPoolOptions: {
            useFingerprints: true, // this is the default
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    browsers: [{
                        name: BrowserName.edge,
                        minVersion: 96,
                    }],
                    devices: [
                        DeviceCategory.desktop,
                    ],
                    operatingSystems: [
                        OperatingSystemsName.windows,
                    ],
                },
            },
        },
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 1,
        // Use the requestHandler to process each of the crawled pages.
        requestHandler: async ({ request, response, page, log }) => {
            if (!response.ok()) {
                emitter.emit('error', new Error(response.statusText(), {
                    cause: {
                        request: {
                            url: request.url
                        },
                        response: {
                            status: response.status()
                        }
                    }
                }))
                await page.close()
                return
            }

            const { options } = request.userData
            log.info(`Archiving ${request.url}...`)

            const html = await page.content()
            const gallery = await page.$('.gallery .swipe')
            const imageUrls = []
            if (gallery) {
                await gallery.hover()
                await gallery.click()
                await page.waitForSelector('.gallery.big')

                imageUrls.push(await page.evaluate(() => {
                    const imageElements = document.querySelectorAll('.gallery.big .slide img')
                    const urls = []

                    // Loop through the image elements and extract the 'src' attribute
                    imageElements.forEach((img) => {
                        const url = img.getAttribute('src')
                        urls.push(url)
                    })

                    return urls
                }))
            }

            logger.debug({ namespace, message: JSON.stringify({ url: request.url, html, imageUrls: imageUrls.flat() }) })
            emitter.emit('crawled', { url: request.url, html, imageUrls: Array.from(new Set(imageUrls.flat())), ...options })
            const buffer = await page.screenshot()
            emitter.emit('screenshot', { buffer, uuid: options.listingUUID })
            await page.close()
        }
    })
    redis.ZINCRBY(`crawlers`, 1, clientId)
    return crawler
}
async function run(crawler, urlMap, options) {
    const urls = urlMap.map(m => m.split(' ')[1])
    const uuids = urlMap.map(m => m.split(' ')[0])

    try {
        if (crawler.running) {
            crawler.addRequests(urls.map(url => ({ url, userData: { options } })))
        } else {
            await crawler.run(urls.map(url => ({ url, userData: { options } })))
            crawler.requestQueue.drop()
        }
    } catch (error) {
        config.NODE_ENV === 'production' ? logger.error(error) : logger.debug({ namespace, message: error })
    } finally {
        const multi = redis.multi()
        uuids.forEach(uuid => multi.DEL(`running-${uuid}`))
        multi.exec()
    }
}
process.on('SIGUSR2', async () => {
    const queuedKeys = await redis.KEYS(`queued-*`)
    const runningKeys = await redis.KEYS(`running-*`)
    await Promise.all([
        redis.ZREMRANGEBYRANK(`crawlers`, 0, -1),
        ...queuedKeys.map(key => redis.DEL(key, 0, -1)),
        ...runningKeys.map(key => redis.DEL(key, 0, -1))
    ])
})
