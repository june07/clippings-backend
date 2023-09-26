const winston = require('winston');
var { Loggly } = require('winston-loggly-bulk');
const config = require('./config');

winston.add(new Loggly({
    token: config.LOGGLY_API_KEY,
    subdomain: config.LOGGLY_SUBDOMAIN,
    tags: ["Winston-NodeJS"],
    json: true
}));

const enumerateErrorFormat = winston.format((info) => {
    if (info instanceof Error) {
        Object.assign(info, { message: info.stack });
    }
    return info;
});

const logger = winston.createLogger({
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    format: winston.format.combine(
        enumerateErrorFormat(),
        config.NODE_ENV === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
        winston.format.splat(),
        winston.format.printf(({ level, message }) => `${level}: ${message}`)
    ),
    transports: [
        new winston.transports.Console({
            stderrLevels: ['error'],
        }),
    ],
});

module.exports = logger;
