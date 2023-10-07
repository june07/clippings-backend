const { until } = require('async')
const { customAlphabet } = require('nanoid')
const shortCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 3)
const { v5: uuidv5 } = require('uuid')

const logger = require('../../config/logger')
const { crawlerService } = require('../../components/crawler')
const { parserService } = require('../../components/parser')
const redis = require('../../config/redis')
const { githubService } = require('../../components/github')

const { CRAWL_INTERVAL_MS } = process.env

let local = {
    intervals: {}
}
async function _setInterval(socket, uuid) {
    const { clientId } = socket.craigslist
    const redisClientsPerUUIDKey = `clients-${uuid}`

    const interval = setInterval(() => {
        console.log(`${new Date().toLocaleTimeString()}: running interval for redisClientsPerUUIDKey: ${redisClientsPerUUIDKey}, clientId: ${clientId}`)
        crawlerService.get({
            ...socket.craigslist,
            nocache: true
        })
    }, CRAWL_INTERVAL_MS)
    const intervalId = interval[Symbol.toPrimitive]()
    local.intervals[intervalId] = Date.now()
    await redis.HSET(`intervalIds`, uuid, JSON.stringify({
        id: intervalId,
        timestamp: local.intervals[intervalId]
    }))
}
async function addNewSearch(url, uuid, clientId) {
    const gotScraping = await import('got-scraping')
    const redisClientsPerUUIDKey = `clients-${uuid}`
    const { body } = await gotScraping.got(url)

    const metadata = await parserService.parseMetadata(body)

    const multi = redis.multi()
    multi.SADD(redisClientsPerUUIDKey, clientId)
    multi.HSET('searches', uuid, JSON.stringify({
        url,
        uuid,
        metadata
    }))
    await multi.exec()
}
function router(io) {
    console.log('Setting up io routes...')
    io.of('/').on('connection', socket => {
        const clientId = `${socket.request.headers['x-forward-for']}_${socket.sessionId}`

        socket.on('get', async (url, callback) => {
            const uuid = uuidv5(url, uuidv5.URL)
            const { nocache } = socket.handshake.query
            const updateEmitterName = `update-${uuid}`
            const redisClientsPerUUIDKey = `clients-${uuid}`

            socket.craigslist = { url, uuid, nocache, clientId }

            const { json, isCached, emitter: crawlerServiceEmitter } = await crawlerService.get(socket.craigslist)
            if (json) {
                callback({ json, isCached })
            }
            if (!crawlerServiceEmitter._events[updateEmitterName]) {
                crawlerServiceEmitter.on('update', payload => {
                    socket.nsp.emit('update', payload)
                })
                crawlerServiceEmitter.on(updateEmitterName, payload => {
                    if ((payload.json?.uuid || payload.diff?.uuid) === uuid) {
                        if (payload.diff) delete payload.json
                        if (payload.diff?.listings && Object.keys(payload.diff.listings).length) {
                            socket.nsp.emit('update', payload)
                        }
                    }
                })
                .on('screenshot', payload => {
                    if (payload.uuid === uuid) {
                        socket.nsp.emit('screenshot', payload)
                    }
                })
            }
            if (!(await redis.SMEMBERS(redisClientsPerUUIDKey)).length) {
                addNewSearch(url, uuid, clientId)
                let cachedInterval = await redis.HGET(`intervalIds`, uuid)
                if (!cachedInterval) {
                    crawlerService.get({
                        ...socket.craigslist,
                        nocache: true
                    })
                    _setInterval(socket, uuid)
                } else {
                    cachedInterval = JSON.parse(cachedInterval)
                    if (cachedInterval.timestamp < Date.now() + CRAWL_INTERVAL_MS) {
                        clearInterval(cachedInterval.id)
                        crawlerService.get({
                            ...socket.craigslist,
                            nocache: true
                        })
                        _setInterval(socket, uuid)
                    }
                }
            }
        }).on('sync', (remoteState) => {
            if (remoteState) {
                socket.broadcast.emit('remoteState', remoteState)
            } else {
                socket.broadcast.emit('sync')
            }
        }).on('relink', async (code, callback) => {
            socket.join(code)
            callback(`relinked with code ${code}`)
        }).on('unlink', async (code, callback) => {
            const sid = socket.request.session.id
            const primarySId = await redis.GET(`linkCodes-${code}`)

            if (primarySId) {
                const cachedCode = await redis.HGET(primarySId, 'linkCode')
                if (cachedCode === code) {
                    redis.HDEL(primarySId, sid)
                    socket.leave(code)
                    callback(`unlinked with code ${code}`)
                } else {
                    callback('bad code')
                }
            } else {
                callback('bad code')
            }
        }).on('link', async (callback) => {
            const sid = socket.request.session.id
            let code = await redis.HGET(sid, 'linkCode')

            if (!code) {
                await until(
                    async callback => {
                        code = shortCode()
                        const cachedCode = await redis.GET(`linkCodes-${code}`)
                        callback(null, !cachedCode)
                    },
                    () => { },
                    async () => {
                        const multi = redis.multi()
                        multi.SET(`linkCodes-${code}`, sid)
                        multi.HSET(sid, 'linkCode', code)
                        await multi.exec()
                    }

                )
            }

            socket.join(code)
            callback(code)
        }).on('linked', async (code, callback) => {
            const sid = socket.request.session.id
            const primarySId = await redis.GET(`linkCodes-${code}`)

            if (primarySId) {
                const cachedCode = await redis.HGET(primarySId, 'linkCode')
                if (cachedCode === code) {
                    redis.HSET(primarySId, sid, new Date().toISOString())
                    socket.join(code)
                    callback(`device linked with code ${code}`)
                    socket.to(code).emit('linked', `device linked with code ${code}`)
                } else {
                    callback('bad code')
                }
            } else {
                callback('bad code')
            }
        }).on('audioQueue', async (queue) => {
            if (queue) {
                socket.broadcast.emit('audioQueue', queue)
            }
        }).on('searchesList', async callback => {
            const searches = await redis.HGETALL('searches')
            callback(searches ? Object.values(searches) : [])
        }).on('archive', async (url) => {
            const uuid = uuidv5(url, uuidv5.URL)

            socket.craigslist = { url, uuid, clientId }

            await crawlerService.archive(socket.craigslist)
        }).on('updateDiscussion', async (giscusDiscussion) => {
            const { id, totalCommentCount } = giscusDiscussion

            const commentData = await githubService.getCommentData(id)
            if (commentData?.title) {
                socket.broadcast.emit('updatedDiscussion', commentData)
                await redis.HSET('commented', commentData.title, totalCommentCount) // commentData.title === pid
            }
        })
            .on('disconnect', async (_reason) => {
                if (!socket?.craigslist?.uuid) return
                const { uuid, clientId } = socket.craigslist
                const redisClientsPerUUIDKey = `clients-${uuid}`

                await redis.SREM(redisClientsPerUUIDKey, clientId)
                const members = await redis.SMEMBERS(redisClientsPerUUIDKey)
                /** some other factors should be considered before removing the search since alerts can still be received when offline */
                if (!members.length) {
                    const intervalId = await redis.HGET(`intervalIds`, uuid)
                    if (local.intervals[intervalId]) {
                        clearInterval(intervalId)
                        delete local.intervals[intervalId]
                        redis.HDEL(`intervalIds`, uuid)
                    }
                }
            })
    })
}

module.exports = router

process.on('SIGUSR2', async () => {
    const socketsKeys = await redis.KEYS(`clients-*`)
    await Promise.all([
        redis.DEL(`intervalIds`),
        ...socketsKeys.map(key => redis.DEL(key, 0, -1))
    ])
})