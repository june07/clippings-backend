const winston = require('winston')
const config = require('./config')
const LogzioWinstonTransport = require('winston-logzio')

const logzioWinstonTransport = new LogzioWinstonTransport({
    level: 'info',
    name: 'winston_logzio',
    token: config.LOGZIO_TOKEN,
    host: 'listener.logz.io',
    debug: true
})

const enumerateErrorFormat = winston.format((info) => {
    if (info instanceof Error) {
        Object.assign(info, { message: info.stack })
    }
    return info
})

const logger = winston.createLogger({
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    format: winston.format.combine(
        enumerateErrorFormat(),
        config.NODE_ENV === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
        winston.format.splat(),
        winston.format.printf(({ level, message }) => `${level}: ${message}`)
    ),
    transports: config.NODE_ENV === 'production' ? [
        logzioWinstonTransport,
        new winston.transports.Console({
            stderrLevels: ['info', 'error'],
        })
    ] : [
        new winston.transports.Console({
            stderrLevels: ['info', 'error'],
        })
    ]
})

if (config.NODE_ENV !== 'production') {
    const debugTransport = new winston.transports.Console({
        format: winston.format.simple(),
        stderrLevels: ['error'],
    })
    debugTransport.on('logging', (_transport, info) => {
        console.log(info.message)
        debug.enable(info.namespace)
        debug(info.message)
        debug.disable(info.namespace)
    })
    logger.transports.push(debugTransport)
}

module.exports = logger
