const contactService = require('./contact.service')

async function updateContact(params, socket) {
    const { id, name, email, phone, relationship } = params

    const contact = contactService.updateContact(id, name, email, phone, relationship)
    socket.emit('contact-set', contact)
}
async function deleteContact(params, socket) {
    const { id } = params

    const contact = contactService.deleteContact(id)
    socket.emit('contact-set', contact)
}

module.exports = {
    updateContact,
    deleteContact
}