const Brevo = require('@getbrevo/brevo')
const SparkPost = require('sparkpost')

const config = require('../../config/config')
const logger = require('../../config/logger')
const { adService } = require('../../components/ad')

const namespace = 'clippings-backend:mail:service'
const defaultClient = Brevo.ApiClient.instance
let apiKey = defaultClient.authentications['api-key']
apiKey.apiKey = config.SENDINBLUE_API_KEY
const transactionalEmailApiInstance = new Brevo.TransactionalEmailsApi()
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
            logger.info({ namespace, message: `Added user to [${list.name}] email list (${list.id})` })
            resolve(`Added ${email} to [${list.name}] email list`)
        }, function (error) {
            logger.error({ namespace, message: error })
            resolve(error)
        })
    })
}
async function sendTransacEmail(type, options) {
    let p

    if (type === 'daily') {
        const nonBlacklistedEmailAddresses = (await contactsApiInstance.getContactsFromList(14))?.contacts?.filter(contact => !contact.emailBlacklisted)
        let sendSmtpEmail = new Brevo.SendSmtpEmail()

        sendSmtpEmail = {
            bcc: config.NODE_ENV === 'production' ? nonBlacklistedEmailAddresses : [{ email: config.TEST_EMAIL_RECIPIENT }],
            templateId: 16,
            params: {
                ads: options.ads,
                date: new Date().toLocaleDateString()
            },
        }
        p = transactionalEmailApiInstance.sendTransacEmail(sendSmtpEmail)
    }

    return p.then(
        async function (data) {
            logger.info('API called successfully. Returned data: ', data)
        },
        function (error) {
            logger.error(error)
        }
    )
}
async function sendContactConfirmation(contact) {

}
async function sendAlert(contacts, alert, callback) {
    const archivedListing = await adService.getArchivedAd(alert.listingPid)
    const options = {
        content: {
            from: 'noreply@june07.com',
            subject: `Emergency Alert from ${alert.from}`,
            html: `<html><body>
    <p>This alert was created by ${alert.from} to be sent in an emergency.</p>
    
    <p>${alert.from} met up with someone from this online classified ad listing: ${archivedListing.url}</p>
    
    <p>More information about the ad can be found at https://clippings.june07.com/alert/${alert._id}</p>
</body></html>`
        },
        recipients: contacts.map(contact => ({ name: contact.name, address: contact.email }))
    }

    config.NODE_ENV === 'production'
        ? sparky.transmissions.send(options)
            .then(data => {
                logger.info({ namespace, message: 'Woohoo! You just sent your first mailing!' })
                callback({
                    sentOn: Date.now(),
                    ...alert
                })
            })
            .catch(err => {
                logger.info({ namespace, message: err })
                callback()
            })
        : (() => {
            logger.info({ namespace, message: `sparky.transmissions.send(${JSON.stringify(options, null, '  ')})` })
            callback({
                sentAt: Date.now(),
                ...alert
            })
        })()
}

if (config.NODE_ENV !== 'production') {
    global.sendTransacEmail = sendTransacEmail
}
module.exports = {
    addContactToDailyList,
    sendTransacEmail,
    sendContactConfirmation,
    sendAlert
}
