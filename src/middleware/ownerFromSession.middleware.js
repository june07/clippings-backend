const { LRUCache } = require('lru-cache')

const { ContactModel } = require('../components/contact')

const cache = new LRUCache({ max: 500 })

async function ownerFromSession(socket, callback) {
    const { sessionId } = socket
    const owner = cache.get(`owner-sid:${sessionId}`) || await (async () => {
        const contact = await ContactModel.findOne({ sessionId }, { '_id': 1 }, { lean: true })
        if (contact) {
            cache.set(`owner-sid:${sessionId}`, contact)
            return contact
        }
    })()

    if (!owner) {
        callback(new Error('no owner found'))
    } else {
        socket.owner = owner
        callback()
    }
}

module.exports = ownerFromSession
