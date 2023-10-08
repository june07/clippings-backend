const { logger } = require('../../config')
const redis = require('../../config/redis')
const CrawlerWorker = require('./crawler.worker')

const crawlerWorker = new CrawlerWorker(redis)
const namespace = 'jc-backend:crawler:service'

crawlerWorker.emitter.on('update', payload => {
    crawlerWorker.emitter.emit(`update-${payload?.diff?.uuid || payload?.json?.uuid}`, payload)
})

const get = async (options) => {
    const { listingURL, searchUUID, nocache } = options
    let cached = await redis.GET(`cl-json-${searchUUID}`)

    if (cached && !nocache) {
        cached = JSON.parse(cached)
        if (await redis.GET(`running-${searchUUID}`)) {
            logger.debug({ namespace, message: 'crawlee is running already, returning cached response', listingURL })
        } else {
            logger.debug({ namespace, message: 'nocache is not set, returning cached response', listingURL })
        }
        return { json: cached, isCached: true, emitter: crawlerWorker.emitter }
    }
    logger.debug({ namespace, message: 'attempting to crawl...', searchUUID })
    crawlerWorker.crawl(options)
    return { emitter: crawlerWorker.emitter }
}
const archive = async (options) => {
    const { listingUUID } = options
    let cached = await redis.HGET('archives', listingUUID)

    if (cached) {
        cached = JSON.parse(cached)

        return { archive: cached, isCached: true, emitter: crawlerWorker.emitter }
    }
    crawlerWorker.archive(options)
    return { emitter: crawlerWorker.emitter }
}

module.exports = {
    get,
    archive
}