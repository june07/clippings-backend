const { createClient } = require('redis')

const logger = require('./logger')
const config = require('./config')

const { REDIS_URL, REDIS_HOST_PASSWORD, REDIS_PORT, REDIS_DB } = config
const redisURL = REDIS_URL || `redis://default:${REDIS_HOST_PASSWORD}@redis:${REDIS_PORT || 6379}/${parseInt(REDIS_DB, 10) || 0}` || 'redis://redis'
const redisURLSafe = REDIS_URL || `redis://default:${REDIS_HOST_PASSWORD.replace(/.*/g, '****')}@redis:${REDIS_PORT || 6379}/${parseInt(REDIS_DB, 10) || 0}` || 'redis://redis'

console.log('Redis URL:', redisURLSafe)
const redis = createClient({
    url: redisURL,
})

redis.on('error', err => logger.error('Redis Client Error', err))
redis.connect().then(redis => {
    logger.info('Connected to Redis')
})

module.exports = redis
