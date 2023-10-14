const { CronJob } = require('cron')

const { logger, config } = require('../../config')
const mailService = require('./mail.service')
const { craigslistService } = require('../../components/adServiceProvider/craigslist')

const namespace = 'clippings-backend:cron:service'

const job = new CronJob(
    '0 0 0 * * *',
    async () => {
        const listings = await craigslistService.transferData()
        const ads = craigslistService.filterYesterdays(listings)

        if (ads.length) {
            mailService.sendTransacEmail('daily', { ads })
        }
    },
    () => logger.info({ namespace, message: 'completed cron job' }),
    true,
    'America/Los_Angeles'
)

job.start()
logger.info({ namespace, message: 'started cron service' })
