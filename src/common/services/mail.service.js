const Brevo = require('@getbrevo/brevo')
const SparkPost = require('sparkpost')

const { config, logger, redis } = require('../../config')
const { adService } = require('../../components/ad')

const namespace = 'clippings-backend:mail:service'

const transactionalEmailApiInstance = new Brevo.TransactionalEmailsApi()
transactionalEmailApiInstance.authentications['apiKey'].apiKey = config.SENDINBLUE_API_KEY

const contactsApiInstance = new Brevo.ContactsApi()
const sparky = new SparkPost(config.SPARKPOST_API_KEY)

async function addContactToDailyList(email) {
    const list = { name: 'daily', id: 14, templateId: 18 }

    const createDoiContact = new Brevo.CreateDoiContact(
        email,
        [list.id],
        list.templateId,
        'https://clippings.june07.com/thanks')

    return await new Promise(resolve => {
        contactsApiInstance.createDoiContact(createDoiContact).then(function () {
            logger.log({ level: 'info', namespace, message: `Added user to [${list.name}] email list (${list.id})` })
            resolve(`Added ${email} to [${list.name}] email list`)
        }, function (error) {
            logger.error({ namespace, message: error })
            resolve(error)
        })
    })
}
async function sendTransacEmail(type, options) {
    const lockKey = 'mailService.sendTransacEmail'
    const lock = await redis.SET(lockKey, options.id, { NX: true, PX: 10000 })

    if (!lock) {
        logger.error({
            namespace,
            message: 'Could not acquire lock',
            meta: { type, id: options.id }
        })
        return
    }

    let p

    try {
        if (type === 'daily') {
            const allContacts = await contactsApiInstance.getContactsFromList(14)
            const nonBlacklisted = allContacts?.contacts?.filter(contact => !contact.emailBlacklisted) || []

            const sendSmtpEmail = new Brevo.SendSmtpEmail({
                bcc: config.NODE_ENV === 'production'
                    ? nonBlacklisted
                    : [{ email: config.TEST_EMAIL_RECIPIENT }],
                templateId: 16,
                params: {
                    ads: options.ads,
                    date: new Date().toLocaleDateString()
                },
            })

            logger.info({
                namespace,
                message: 'Sending transactional email',
                meta: {
                    type,
                    recipientCount: sendSmtpEmail.bcc.length,
                    templateId: sendSmtpEmail.templateId,
                    testMode: config.NODE_ENV !== 'production'
                }
            })

            p = await transactionalEmailApiInstance.sendTransacEmail(sendSmtpEmail)

            logger.info({
                namespace,
                message: 'Transactional email sent successfully',
                meta: { type, id: options.id, response: p }
            })

        } else {
            logger.warn({
                namespace,
                message: `Unhandled email type: ${type}`,
                meta: { id: options.id }
            })
        }
    } catch (error) {
        logger.error({
            namespace,
            message: 'Error sending transactional email',
            meta: {
                type,
                id: options.id,
                error: error?.response?.body || error.message || error
            }
        })
    } finally {
        try {
            await redis.DEL(lockKey)
        } catch (delErr) {
            logger.error({
                namespace,
                message: 'Failed to release Redis lock',
                meta: { id: options.id, error: delErr }
            })
        }
    }

    return p
}

function providerPathFromURL(url) {
    if (/craigslist.org/i.test(url)) {
        return 'cl'
    }
}
async function sendAlert(contacts, alert, callback) {
    const archivedListing = await adService.getArchivedAd(alert.listingPid)
    const providerPathId = providerPathFromURL(archivedListing.url)
    const options = {
        content: {
            from: 'noreply@june07.com',
            subject: `Emergency Alert from ${alert.from}`,
            html: `<html><body>
    <p>This alert was created by ${alert.from} to be sent in an emergency.</p>
    
    <p>${alert.from} met up with someone from this online classified ad listing: ${archivedListing.url}</p>
    
    <p>More information about the ad can be found at https://clippings.june07.com/archive/${providerPathId}/${archivedListing.listingPid}</p>
</body></html>`
        },
        recipients: contacts.map(contact => ({ name: contact.name, address: contact.email }))
    }

    config.NODE_ENV === 'production'
        ? sparky.transmissions.send(options)
            .then(data => {
                logger.log({ level: 'info', namespace, message: 'Woohoo! You just sent your first mailing!' })
                callback({
                    receipt: {
                        id: data.results.id,
                        sentAt: Date.now()
                    },
                    message: alert.message._id,
                    to: alert.to.map(to => to._id),
                    ...alert
                })
            })
            .catch(err => {
                logger.log({ level: 'info', namespace, message: err })
                callback()
            })
        : (() => {
            logger.log({ level: 'info', namespace, message: `sparky.transmissions.send(${JSON.stringify(options)})` })
            callback({
                receipt: {
                    id: `[(id) only generated in production]`,
                    sentAt: Date.now()
                },
                ...alert
            })
        })()
}
async function sendOptIn(receipient, from, code) {
    const options = {
        substitution_data: {
            from,
            code
        },
        content: {
            template_id: 'clippings-opt-in'
        },
        recipients: [receipient]
    }

    config.NODE_ENV === 'production'
        ? sparky.transmissions.send(options)
            .then(data => {
                logger.log({ level: 'info', namespace, message: 'Woohoo! You just sent your first mailing!' })
            })
            .catch(err => {
                logger.log({ level: 'info', namespace, message: err })
            })
        : (() => {
            logger.log({ level: 'info', namespace, message: `sparky.transmissions.send(${JSON.stringify(options)})` })
        })()
}
if (config.NODE_ENV !== 'production') {
    global.sendTransacEmail = sendTransacEmail
}
module.exports = {
    addContactToDailyList,
    sendTransacEmail,
    sendAlert,
    sendOptIn
}
