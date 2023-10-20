const Joi = require('joi');
const { ObjectId } = require('mongoose').Types;

const objectId = Joi.string().length(24).hex().custom((value, helpers) => {
  if (!ObjectId.isValid(value)) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'custom validation');

module.exports = {
    objectId
}
