const Brevo = require('@getbrevo/brevo')

const config = require('../../config/config')
const logger = require('../../config/logger')

const namespace = 'clippings-backend:mail:service'
const defaultClient = Brevo.ApiClient.instance
let apiKey = defaultClient.authentications['api-key']
apiKey.apiKey = config.SENDINBLUE_API_KEY
const transactionalEmailApiInstance = new Brevo.TransactionalEmailsApi()
const contactsApiInstance = new Brevo.ContactsApi()

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
if (config.NODE_ENV !== 'production') {
    global.sendTransacEmail = sendTransacEmail
}
module.exports = {
    addContactToDailyList,
    sendTransacEmail
}
