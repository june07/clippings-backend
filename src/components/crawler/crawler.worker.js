const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')

const { config, logger, redis } = require('../../config')
const { githubService } = require('../github')

const namespace = 'jc-backend:crawler:worker'
const crawleeConfig = Configuration.getGlobalConfig()
crawleeConfig.set('logLevel', config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')

class CrawlerWorker extends EventEmitter {
    constructor() {
        super()
        this.emitter = new EventEmitter()
        this.emitter.on('crawled', async payload => {
            const { listingURL, html, imageUrls, listingPid } = payload

            // store data in git
            const gitUrl = await githubService.saveAdToPages({ url: listingURL, html, imageUrls })
            await redis.HSET('archives', listingPid, JSON.stringify(payload))
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
                crawlers[clientId] = await launchCrawler('archive', urls, emitter, options)
            } else if (!numberOfCrawlers || numberOfCrawlers < (userConfig?.crawlerLimit || 1)) {
                crawlers[clientId] = await launchCrawler('archive', urls, emitter, options)
            }

            crawlers[clientId].options = {
                ...crawlers[clientId].options,
                ...options
            }
            run(crawlers[clientId], urls)
        } else {
            logger.debug({ namespace, message: `${new Date().toLocaleTimeString()}: queued clientId: ${clientId}` })
            redis.HSET(`queued`, clientId, `${listingUUID} ${listingURL}`)
        }
    }
}

module.exports = CrawlerWorker

function getRequestHandler(options) {
    const { type } = options
    let handler

    if (type === 'archive') {
        handler = async ({ request, page, log }) => {
            const { emitter } = options
            log.info(`Archiving ${request.url}...`)

            const html = await page.content()
            const gallery = await page.$('.gallery .swipe')
            await gallery.hover()
            await gallery.click()
            await page.waitForSelector('.gallery.big')

            const imageUrls = await page.evaluate(() => {
                const imageElements = document.querySelectorAll('.gallery.big .slide img')
                const urls = []

                // Loop through the image elements and extract the 'src' attribute
                imageElements.forEach((img) => {
                    const url = img.getAttribute('src')
                    urls.push(url)
                })

                return urls
            })

            logger.debug({ namespace, message: JSON.stringify({ url: request.url, html, imageUrls }) })
            const filteredOptions = { ...options }
            delete filteredOptions.emitter
            emitter.emit('crawled', { url: request.url, html, imageUrls: Array.from(new Set(imageUrls)), ...filteredOptions })
            const buffer = await page.screenshot()
            emitter.emit('screenshot', { buffer, uuid: options.listingUUID })
            await page.close()
        }
    }
    return handler
}
async function launchCrawler(type, urlMap, emitter, options) {
    const { clientId } = options
    const requestHandler = getRequestHandler({ type, urlMap, emitter, ...options })
    const crawlerWrapper = {
        crawler: new PlaywrightCrawler({
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
            requestHandler
        }),
        options: { type, emitter }
    }
    redis.ZINCRBY(`crawlers`, 1, clientId)
    return crawlerWrapper
}
async function run(crawlerWrapper, urlMap, options) {
    const urls = urlMap.map(m => m.split(' ')[1])
    const uuids = urlMap.map(m => m.split(' ')[0])
    const { crawler } = crawlerWrapper

    crawler.requestHandler = getRequestHandler({ urlMap, ...options })
    try {
        if (crawler.running) {
            crawler.addRequests(urls)
        } else {
            await crawler.run(urls)
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
