const { LRUCache } = require('lru-cache')

const MessageModel = require('./message.model')

const cache = new LRUCache({ max: 500 })

async function createMessage(owner, text) {
    const message = await MessageModel.create({ owner, text, title })
    return message
}
async function readMessages(owner) {
    const messages = await MessageModel.find({ owner }, { '__v': 0 }, { lean: true })
    const defaultMessage = new Promise(resolve => {
        const cached = cache.get('defaultMessage')
        if (cached) {
            resolve(cached)
        } else {
            MessageModel.findOne({ owner: 'system', title: 'default alert message' }, { '__v': 0 }, { lean: true })
                .then(defaultMessage => {
                    cache.set('defaultMessage', defaultMessage)
                    resolve(defaultMessage)
                })
        }
    })

    return messages.length ? messages : [cache.get('defaultMessage') || await defaultMessage]
}
async function updateMessage(_id, owner, text, title) {
    const messageObj = { _id, owner, text, title }
    const message = await MessageModel.findOneAndUpdate({ _id }, messageObj, { lean: true, new: true, upsert: true })
    return { ...message, _id: message._id.toString() }
}
async function deleteMessage(_id) {
    await MessageModel.findByIdAndDelete(_id)
}

module.exports = {
    readMessages,
    createMessage,
    updateMessage,
    deleteMessage,
}