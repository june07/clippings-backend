const { CronJob } = require('cron')

const { logger, config } = require('../../config')
const mailService = require('./mail.service')
const { craigslistService } = require('../../components/adServiceProvider/craigslist')
const { alertService } = require('../../components/alert')

const namespace = 'clippings-backend:cron:service'

const transactEmailCron = new CronJob(
    '0 0 0 * * *',
    async () => {
        const listings = await craigslistService.transferData()
        const ads = craigslistService.filterYesterdays(listings)

        if (ads.length) {
            mailService.sendTransacEmail('daily', { ads })
        }
    },
    () => logger.info({ namespace, message: 'completed transactEmailCron cron job' }),
    true,
    'America/Los_Angeles'
)
const cacheAlertsCron = new CronJob(
    '0 0 * * * *',
    async () => {
        await alertService.cacheAlerts(3_600_000)        
    },
    () => logger.info({ namespace, message: 'completed cacheAlertsCron cron job' }),
    true,
    'America/Los_Angeles'
)
const sendAlertsCron = new CronJob(
    '0 * * * * *',
    () => {
        alertService.sendAlerts()
    },
    () => logger.info({ namespace, message: 'completed sendAlertsCron cron job' }),
    true,
    'America/Los_Angeles'
)

global.cacheAlerts = alertService.cacheAlerts

transactEmailCron.start()
cacheAlertsCron.start()
sendAlertsCron.start()

logger.info({ namespace, message: 'started cron service' })
