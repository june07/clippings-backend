/**
 * Create an object composed of the picked object properties
 * @param {Object} object
 * @param {string[]} keys
 * @returns {Object}
 */
const pick = (object, keys) => {
  return keys.reduce((obj, key) => {
    const renamedKey = key.split(":")[1]
    key = key.split(":")[0]
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      // eslint-disable-next-line no-param-reassign
      obj[renamedKey ? renamedKey : key] = object[key];
    }
    return obj;
  }, {});
};

module.exports = pick;
