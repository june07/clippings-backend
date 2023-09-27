const debug = require('debug')(`jc-backend:crawler:service`)

const redis = require('../../config/redis')
const CrawlerWorker = require('./crawler.worker')

const crawlerWorker = new CrawlerWorker(redis)

crawlerWorker.emitter.on('update', payload => {
    payload
    if (payload.diff?.uuid) {
        crawlerWorker.emitter.emit(`update-${payload.diff.uuid}`, payload)
    }
})

const get = async (options) => {
    const { url, uuid, nocache } = options
    let cached = await redis.GET(`cl-json-${uuid}`)

    if (cached && !nocache) {
        cached = JSON.parse(cached)
        if (await redis.GET(`cl-running-${uuid}`)) {
            debug('crawlee is running already, returning cached response', url)
        } else {
            debug('nocache is not set, returning cached response', url)
        }
        return { json: cached, isCached: true, emitter: crawlerWorker.emitter }
    }
    crawlerWorker.crawl(options)
    return { emitter: crawlerWorker.emitter }
}

module.exports = {
    get
}