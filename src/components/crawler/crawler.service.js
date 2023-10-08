const { logger } = require('../../config')
const redis = require('../../config/redis')
const CrawlerWorker = require('./crawler.worker')

const crawlerWorker = new CrawlerWorker(redis)
const namespace = 'jc-backend:crawler:service'

const archive = async (options) => {
    const { listingPid } = options
    let cached = await redis.HGET('archives', listingPid)

    if (cached) {
        cached = JSON.parse(cached)

        return { archive: cached, isCached: true, emitter: crawlerWorker.emitter }
    }
    crawlerWorker.archive(options)
    return { emitter: crawlerWorker.emitter }
}

module.exports = {
    archive
}