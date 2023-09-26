const debug = require('debug')(`crawler:worker`)
const { hostname } = require('os')
const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')

const { parserService } = require('../parser')
const { config, logger } = require('../../config')

const crawleeConfig = Configuration.getGlobalConfig()
crawleeConfig.set('logLevel', config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')

class CrawlerWorker extends EventEmitter {
    constructor(redis) {
        super()
        this.redis = redis
        this.emitter = new EventEmitter()
        this.emitter.on('parse', async payload => {
            const { json, diff } = await parserService.parse(payload)


            if (diff?.listings && Object.keys(diff.listings).length) {
                this.emitter.emit('update', { diff })
            } else if (json) {
                this.emitter.emit('update', { json })
            }
        })
        this.crawlers = {}
    }
    async crawl(options) {
        const { redis, emitter, crawlers } = this
        const { url, uuid, sessionId } = options
        const isRunning = await redis.GET(`running-${hostname()}-${uuid}`)

        if (!isRunning) {
            // check to see if the user is at the maximum crawler limit first and wait for the next cycle, otherwise start a new crawl
            const userConfig = JSON.parse(await redis.HGET('userConfig', sessionId))
            const numberOfCrawlers = await redis.ZSCORE(`crawlers-${hostname()}`, sessionId)

            await redis.SET(`running-${hostname()}-${uuid}`, new Date().toLocaleString(), { EX: 120 })
            
            const multi = redis.multi()
            multi.HVALS(`queued-${hostname()}`, sessionId)
            multi.HKEYS(`queued-${hostname()}`, sessionId)
            const results = await multi.exec()
            const urls = results[0]
            results[1].map(key => redis.HDEL(`queued-${hostname()}`, key))

            if (!crawlers[sessionId]) {
                crawlers[sessionId] = await launchCrawler(urls, emitter, sessionId)
            } else if (!numberOfCrawlers || numberOfCrawlers < userConfig?.crawlerLimit || 1) {
                crawlers[sessionId] = await launchCrawler(urls, emitter, sessionId)
            }

            run(crawlers[sessionId], urls)
        } else {
            console.log(`${new Date().toLocaleTimeString()}: queued sessionId: ${sessionId}`)
            redis.HSET(`queued-${hostname()}`, sessionId, `${uuid} ${url}`)
        }
    }
}

module.exports = CrawlerWorker

async function launchCrawler(urlMap, emitter, sessionId) {
    const crawler = new PlaywrightCrawler({
        launchContext: {
            useIncognitoPages: true,
            launchOptions: {
                args: [
                    '--no-zygote',
                    '--single-process'
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
        async requestHandler({ request, page, log }) {
            log.info(`Processing ${request.url}...`)
            await Promise.all([
                page.waitForLoadState('networkidle'),
                page.waitForLoadState('domcontentloaded'),
                page.waitForLoadState('load')
            ])

            const listItems = await page.$$('li[data-pid]')
            for (const listItem of listItems) {
                const swipe = await listItem.waitForSelector('.swipe', { timeout: 250, state: 'visible' }).catch(() => null)

                if (swipe) {
                    await swipe.hover()
                    const forwardArrow = await listItem.waitForSelector('.slider-forward-arrow', { timeout: 250, state: 'visible' }).catch(() => null)

                    if (forwardArrow) {
                        await forwardArrow.click()
                    }
                }
            }

            const html = await page.content()
            const uuid = urlMap.find(m => m.split(' ')[1] === request.url).split(' ')[0]
            emitter.emit('parse', { url: request.url, uuid, html })
            await page.screenshot({ path: `/tmp/screenshot-${uuid}.png` })
            await page.close()
        }
    })
    redis.ZINCRBY(`crawlers-${hostname()}`, 1, sessionId)
    return crawler
}
async function run(crawler, urlMap) {
    const urls = urlMap.map(m => m.split(' ')[1])
    const uuids = urlMap.map(m => m.split(' ')[0])

    try {
        await crawler.run(urls)
        crawler.requestQueue.drop()
    } catch(error) {
        config.NODE_ENV === 'production' ? logger.error(error) : debug(error)
    } finally {
        const multi = redis.multi()
        uuids.forEach(uuid => multi.DEL(`running-${(hostname())}-${uuid}`))
        multi.exec()
    }
}
process.on('SIGUSR2', async () => {
    const queuedKeys = await redis.KEYS(`queued-${hostname()}-*`)
    const runningKeys = await redis.KEYS(`running-${hostname()}-*`)
    await Promise.all([
        redis.ZREMRANGEBYRANK(`crawlers-${hostname()}`, 0, -1),
        ...queuedKeys.map(key => redis.DEL(key, 0, -1)),
        ...runningKeys.map(key => redis.DEL(key, 0, -1))
    ])
})
