const debug = require('debug')(`jc-backend:routes:v1:io.routes`)
const { until } = require('async')
const { customAlphabet } = require('nanoid')
const shortCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 3)
const { v5: uuidv5 } = require('uuid')

const logger = require('../../config/logger')
const { crawlerService } = require('../../components/crawler')
const redis = require('../../config/redis')

let local = {
    intervals: {}
}
async function _setInterval(socket, uuid) {
    const interval = setInterval(() => {
        console.log(`${new Date().toLocaleTimeString()}: running interval for redisSessionsPerUUIDKey: ${redisSessionsPerUUIDKey}, clientId: ${clientId}`)
        crawlerService.get({
            ...socket.craigslist,
            nocache: true
        })
    }, 60000)
    const intervalId = interval[Symbol.toPrimitive]()
    local.intervals[intervalId] = Date.now()
    await redis.HSET(`intervalIds`, uuid, JSON.stringify({
        id: intervalId,
        timestamp: local.intervals[intervalId]
    }))
}
function router(io) {
    console.log('Setting up io routes...')
    io.of('/').on('connection', socket => {
        const clientId = `${socket.request.headers['cf-connecting-ip']}_${socket.sessionId}`

        socket.on('get', async (url, callback) => {
            const uuid = uuidv5(url, uuidv5.URL)
            const { nocache } = socket.handshake.query
            const updateEmitterName = `update-${uuid}`
            const redisSessionsPerUUIDKey = `sessions-${uuid}`

            socket.craigslist = { url, uuid, nocache, clientId }

            const { json, isCached, emitter } = await crawlerService.get(socket.craigslist)
            if (json) {
                callback({ json, isCached })
            }
            if (!emitter._events[updateEmitterName]) {
                emitter.on(updateEmitterName, payload => {
                    if ((payload.json?.uuid || payload.diff?.uuid) === uuid) {
                        if (payload.diff) delete payload.json
                        if (payload.diff?.listings && Object.keys(payload.diff.listings).length) {
                            socket.nsp.emit('update', payload)
                        }
                    }
                })
            }
            if (!(await redis.SMEMBERS(redisSessionsPerUUIDKey)).length) {
                redis.SADD(redisSessionsPerUUIDKey, clientId)
                let cachedInterval = await redis.HGET(`intervalIds`, uuid)
                if (!cachedInterval) {
                    crawlerService.get({
                        ...socket.craigslist,
                        nocache: true
                    })
                    _setInterval(socket, uuid)
                } else {
                    cachedInterval = JSON.parse(cachedInterval)
                    if (cachedInterval.timestamp > Date.now() + 60000) {
                        clearInterval(cachedInterval.id)
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
        })
            .on('disconnect', async (_reason) => {
                if (!socket?.craigslist?.uuid) return
                const { uuid, clientId } = socket.craigslist
                const redisSessionsPerUUIDKey = `sessions-${uuid}`

                await redis.SREM(redisSessionsPerUUIDKey, clientId)
                const members = await redis.SMEMBERS(redisSessionsPerUUIDKey)
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
    const socketsKeys = await redis.KEYS(`sessions-*`)
    await Promise.all([
        redis.DEL(`intervalIds`),
        ...socketsKeys.map(key => redis.DEL(key, 0, -1))
    ])
})