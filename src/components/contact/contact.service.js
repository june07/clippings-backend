const contactModel = require('./contact.model')

async function updateContact(id, name, email, phone, relationship) {

    const contactObj = { id, name, email, phone, relationship }
    const contact = await contactModel.findOneAndUpdate({ id }, contactObj, { lean: true, new: true, upsert: true })
    return contact
}
async function deleteContact(id) {
    await contactModel.findByIdAndDelete(id)
}

module.exports = {
    updateContact,
    deleteContact
}