const debug = require('debug')(`jc-backend:crawler:worker`)
const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')

const { parserService } = require('../parser')
const { config, logger, redis } = require('../../config')

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
            } else if (json) {
                this.emitter.emit('update', { json })
            }
        })
        this.crawlers = {}
    }
    async crawl(options) {
        const { redis, emitter, crawlers } = this
        const { url, uuid, clientId } = options
        const isRunning = await redis.GET(`running-${uuid}`)

        if (!isRunning) {
            // check to see if the user is at the maximum crawler limit first and wait for the next cycle, otherwise start a new crawl
            const userConfig = JSON.parse(await redis.HGET('userConfig', clientId))
            const numberOfCrawlers = await redis.ZSCORE(`crawlers`, clientId)

            await redis.SET(`running-${uuid}`, new Date().toLocaleString(), { EX: 120 })
            
            const multi = redis.multi()
            multi.HVALS(`queued`, clientId)
            multi.HKEYS(`queued`, clientId)
            const results = await multi.exec()
            const urls = results[0]
            results[1].map(key => redis.HDEL(`queued`, key))

            if (!crawlers[clientId]) {
                crawlers[clientId] = await launchCrawler(urls, emitter, clientId, redis)
            } else if (!numberOfCrawlers || numberOfCrawlers < (userConfig?.crawlerLimit || 1)) {
                crawlers[clientId] = await launchCrawler(urls, emitter, clientId, redis)
            }

            run(crawlers[clientId], urls)
        } else {
            console.log(`${new Date().toLocaleTimeString()}: queued clientId: ${clientId}`)
            redis.HSET(`queued`, clientId, `${uuid} ${url}`)
        }
    }
}

module.exports = CrawlerWorker

async function launchCrawler(urlMap, emitter, clientId, redis) {
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
    redis.ZINCRBY(`crawlers`, 1, clientId)
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
