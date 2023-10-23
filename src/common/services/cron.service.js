const { CronJob } = require('cron')

const { logger, config } = require('../../config')
const mailService = require('./mail.service')
const { craigslistService } = require('../../components/adServiceProvider/craigslist')
const { alertService } = require('../../components/alert')

const namespace = 'clippings-backend:cron:service'

const transactEmailCronFunc = async (onComplete) => {
    const listings = await craigslistService.transferData()
    const ads = craigslistService.filterYesterdays(listings)

    if (ads.length) {
        const id = `daily-${new Date().toLocaleDateString()}`
        mailService.sendTransacEmail('daily', { id, ads })
    }
    onComplete()
}
const transactEmailCron = new CronJob(
    '0 0 0 * * *',
    transactEmailCronFunc,
    () => logger.log({ level: 'info', namespace, message: 'completed transactEmailCron cron job' }),
    true,
    'America/Los_Angeles'
)
const cacheAlertsCron = new CronJob(
    config.NODE_ENV === 'production' ? '0 0 * * * *' : '0 * * * * *',
    async (onComplete) => {
        await alertService.cacheAlerts(3_600_000)
        onComplete()
    },
    () => logger.log({ level: 'info', namespace, message: 'completed cacheAlertsCron cron job' }),
    true,
    'America/Los_Angeles'
)
const sendAlertsCron = new CronJob(
    '0 * * * * *',
    () => {
        alertService.sendAlerts()
    },
    undefined,
    true,
    'America/Los_Angeles'
)

global.cacheAlerts = alertService.cacheAlerts
global.transactEmailCronFunc = transactEmailCronFunc

// call on startup
alertService.cacheAlerts(3_600_000)

transactEmailCron.start()
cacheAlertsCron.start()
sendAlertsCron.start()

logger.log({ level: 'info', namespace, message: 'started cron service' })
