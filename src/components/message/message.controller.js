const messageService = require('./message.service')

async function createMessage(params, socket) {
    const { customAlphabet } = await import('nanoid')
    const titleId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3)

    const { text, title = `Message ${titleId()}` } = params
    const owner = socket.request.sessionId || socket.request.session.id

    const message = await messageService.createMessage(owner, text, title)
    
    socket.emit('messageCreated', message)
}
async function readMessages(socket) {
    const owner = socket.request.sessionId || socket.request.session.id

    const messages = await messageService.readMessages(owner)
    
    return messages
}
async function updateMessage(params, socket) {
    const { _id, owner, text, title } = params

    if (owner !== socket.request.sessionId || socket.request.session.id) {
        socket.emit(new Error(`can't update a message owned by someone else.`))
        return
    }

    const message = await messageService.updateMessage(_id, owner, text, title)
    socket.emit('messageUpdated', message)
}
async function deleteMessage(params, socket) {
    const { _id } = params

    const message = await messageService.deleteMessage(_id)
    socket.emit('messageDeleted', message)
}

module.exports = {
    createMessage,
    readMessages,
    updateMessage,
    deleteMessage
}