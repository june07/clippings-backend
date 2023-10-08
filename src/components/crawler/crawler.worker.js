const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')
const { v5: uuidv5 } = require('uuid')

const { parserService } = require('../parser')
const { config, logger, redis } = require('../../config')
const { githubService } = require('../github')

const namespace = 'jc-backend:crawler:worker'
const crawleeConfig = Configuration.getGlobalConfig()
crawleeConfig.set('logLevel', config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')

class CrawlerWorker extends EventEmitter {
    constructor(redis) {
        super()
        this.redis = redis
        this.emitter = new EventEmitter()
        this.emitter.on('parse', async payload => {
            const { json, diff } = await parserService.parse(payload, redis)

            if (diff?.listings && Object.keys(diff.listings).length) {
                this.emitter.emit('update', { diff })
            }
        }).on('archived', async archive => {
            const { url, uuid, html, imageUrls, searchUUID } = archive

            // store data in git
            const pid = url.match(/\/([^\/]*)\.html/)[1]
            const gitUrl = await githubService.saveAdToPages({ url, html, imageUrls })
            await redis.HSET('archives', uuid, JSON.stringify({
                gitUrl
            }))
            if (searchUUID) {
                // searchUUID can be undefined when archive is initiated by a user vs the system

                const json = JSON.parse(await redis.GET(`cl-json-${searchUUID}`))
                const diff = JSON.parse(await redis.GET(`cl-json-${searchUUID}`))
                const multi = redis.multi()
                multi.SET(`cl-json-${searchUUID}`, JSON.stringify({
                    ...json,
                    listings: {
                        [uuid]: {
                            ...json.listings[uuid],
                            gitUrl
                        },
                        ...json.listings
                    }
                }))
                multi.set(`cl-json-diff-${searchUUID}`, JSON.stringify({
                    ...diff,
                    listings: {
                        [uuid]: {
                            ...diff.listings[uuid],
                            gitUrl
                        },
                        ...diff.listings
                    }
                }))
                await multi.exec()
            }
            this.emitter.emit('update', { archived: { pid, gitUrl } })
        })
        this.crawlers = {}
    }
    async crawl(options) {
        const { redis, emitter, crawlers } = this
        const { listingURL, searchUUID, clientId } = options
        const isRunning = await redis.GET(`running-${searchUUID}`)

        if (!isRunning) {
            logger.debug({ namespace, message: 'crawling', searchUUID })
            // check to see if the user is at the maximum crawler limit first and wait for the next cycle, otherwise start a new crawl
            const userConfig = JSON.parse(await redis.HGET('userConfig', clientId))
            const numberOfCrawlers = await redis.ZSCORE(`crawlers`, clientId)

            await redis.SET(`running-${searchUUID}`, new Date().toLocaleString(), { EX: 30 })

            const multi = redis.multi()
            multi.HVALS(`queued`, clientId)
            multi.HKEYS(`queued`, clientId)
            const results = await multi.exec()
            const urls = Array.from(new Set([...results[0], `${searchUUID} ${listingURL}`])).filter(url => url)

            results[1].map(key => redis.HDEL(`queued`, key))

            if (!crawlers[clientId]) {
                crawlers[clientId] = await launchCrawler(urls, emitter, options, redis)
            } else if (!numberOfCrawlers || numberOfCrawlers < (userConfig?.crawlerLimit || 1)) {
                crawlers[clientId] = await launchCrawler(urls, emitter, options, redis)
            }

            run(crawlers[clientId], urls)
        } else {
            logger.debug({ namespace, message: `${new Date().toLocaleTimeString()}: queued clientId: ${clientId}` })
            redis.HSET(`queued`, clientId, `${searchUUID} ${listingURL}`)
        }
    }
    async archive(options) {
        const { redis, emitter } = this
        const { listingURL } = options

        const crawlerWrapper = await launchCrawler([listingURL], emitter, options, redis, 'archive')
        const { crawler } = crawlerWrapper
        if (crawler.running) {
            crawler.addRequests([listingURL])
        } else {
            await crawler.run([listingURL])
            crawler.requestQueue.drop()
        }
    }
}

module.exports = CrawlerWorker

function getRequestHandler(options) {
    const { type } = options
    let handler

    if (!type) {
        handler = async ({ request, page, log }) => {
            const { urlMap, emitter } = options
            log.info(`Processing ${request.url}...`)
            await Promise.all([
                page.waitForLoadState('networkidle'),
                page.waitForLoadState('domcontentloaded'),
                page.waitForLoadState('load')
            ])
            log.info(`Loaded ${request.url}...`)
            const listItems = await page.$$('li[data-pid]')
            for (const listItem of listItems) {
                const pid = await listItem.evaluate((element) => element.getAttribute('data-pid'))

                //if (!await redis.HGET('pids', pid)) {
                    redis.HSET('pids', pid, Date.now())
                    const swipe = await listItem.waitForSelector('.swipe', { state: 'visible' }).catch(() => null)

                    if (swipe) {
                        await swipe.hover()
                        const forwardArrow = await listItem.waitForSelector('.slider-forward-arrow', { state: 'visible' }).catch(() => null)

                        if (forwardArrow) {
                            await forwardArrow.click()
                        }
                    }
                //}
            }
            log.info(`Interacted ${request.url}...`)
            const html = await page.content()
            const uuid = urlMap.find(m => m.split(' ')[1] === request.url)?.split(' ')[0]
            log.info(`Got html ${html.length}..., uuid: ${uuid}, urlMap: ${urlMap}, page: ${request.url}`)
            if (uuid) {
                emitter.emit('parse', { url: request.url, uuid, html })
                const buffer = await page.screenshot()
                emitter.emit('screenshot', { buffer, uuid })
            }
            await page.close()
        }
    } else if (type === 'archive') {
        handler = async ({ request, page, log }) => {
            const { emitter, searchUUID } = options
            log.info(`Archiving ${request.url}...`)
            await Promise.all([
                page.waitForLoadState('networkidle'),
                page.waitForLoadState('domcontentloaded'),
                page.waitForLoadState('load')
            ])

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

            const uuid = uuidv5(request.url, uuidv5.URL)

            logger.debug({ namespace, message: { url: request.url, uuid, html, imageUrls } })
            emitter.emit('archived', { url: request.url, uuid, html, imageUrls: Array.from(new Set(imageUrls)), searchUUID })
            await page.screenshot({ path: `/tmp/screenshot-${uuid}.png` })
            await page.close()
        }
    }
    return handler
}
async function launchCrawler(urlMap, emitter, options, redis, type) {
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
async function run(crawlerWrapper, urlMap) {
    const urls = urlMap.map(m => m.split(' ')[1])
    const uuids = urlMap.map(m => m.split(' ')[0])
    const { crawler, options: { type, emitter } } = crawlerWrapper

    crawler.requestHandler = getRequestHandler({ type, urlMap, emitter })
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
