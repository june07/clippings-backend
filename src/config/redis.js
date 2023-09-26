const { createClient } = require('redis')

const logger = require('./logger')
const config = require('./config')
const redis = createClient({
    url: config.NODE_ENV === 'production' ? `redis://default:${config.REDIS_HOST_PASSWORD}@redis` : 'redis://redis',
})
redis.on('error', err => logger.error('Redis Client Error', err))
redis.connect().then(redis => {
    logger.info('Connected to Redis')
})

module.exports = redis
