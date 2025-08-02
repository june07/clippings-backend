const { CronJob } = require('cron')

const { logger, config, redis } = require('../../config')
const mailService = require('./mail.service')
const { craigslistService } = require('../../components/adServiceProvider/craigslist')
const { alertService } = require('../../components/alert')
const { adService } = require('../../components/ad')
const { NODE_ENV } = config

const namespace = 'clippings-backend:cron:service'

const transactEmailCronFunc = async (onComplete = () => { }) => {
    const listings = await craigslistService.transferData()
    const ads = craigslistService.filterYesterdays(listings)

    await redis.SET('yesterdaysAds', JSON.stringify(ads), { EX: 60 * 60 * 24 })

    if (ads.length) {
        const id = `daily-${new Date().toLocaleDateString()}`

        logger.log({ level: 'info', namespace, message: `Sending daily email for ${id} with ${ads.length} ads` })
        mailService.sendTransacEmail('daily', { id, ads })
    }
    onComplete()
}
const transactEmailCronFunc2 = async (onComplete = () => { }) => {
    const cacheId = `emails:${new Date().toISOString().split('T')[0]}`
    const yesterdaysAds = await redis.GET('yesterdaysAds')
    
    if (yesterdaysAds?.length) {
        ads = JSON.parse(yesterdaysAds)
    } else if (NODE_ENV !== 'production') {
        const recents = await redis.SRANDMEMBER_COUNT('recent_listings', 3)
        
        ads = recents?.map(ad => JSON.parse(ad))
    }

    if (!ads) {
        onComplete()
        return
    }

    const rawEmails = await redis.SMEMBERS(cacheId)

    // Build a map of listingPid → cleaned email
    const emailMap = new Map()

    rawEmails.forEach(entry => {
        try {
            const parsed = JSON.parse(entry)
            const pid = parsed.listingPid
            let email = parsed.emailAddress

            if (email?.startsWith('mailto:')) {
                email = email.slice(7) // remove 'mailto:'
            }

            // Remove any query string (?subject=...) from email
            email = email.split('?')[0].trim()

            if (pid && email) {
                emailMap.set(pid, email)
            }
        } catch (err) {
            console.warn('Could not parse email entry:', entry, err.message)
        }
    })

    // Enrich the ads with email, if found
    const enrichedAds = ads.map(ad => {
        const pid = ad.listingPid || ad.id
        const email = emailMap.get(pid)

        return { ...ad, email, title: ad.metadata.title }
    }).filter(ad => ad.email)

    if (enrichedAds.length) {
        const id = `featured-${new Date().toLocaleDateString()}`

        logger.log({ level: 'info', namespace, message: `Sending featured email for ${id} with ${enrichedAds.length} ads` })

        mailService.sendTransacEmail('featured', { id, ads: enrichedAds })
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
const transactEmailCron2 = new CronJob(
    '0 0 12 * * *',
    transactEmailCronFunc2,
    () => logger.log({ level: 'info', namespace, message: 'completed transactEmailCron2 cron job' }),
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
global.transactEmailCronFunc2 = transactEmailCronFunc2


// call on startup
alertService.cacheAlerts(3_600_000)

transactEmailCron.start()
cacheAlertsCron.start()
sendAlertsCron.start()

logger.log({ level: 'info', namespace, message: 'started cron service' })
