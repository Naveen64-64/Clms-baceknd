const ApiError = require('../utils/apiError');

const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    if (!schema) return next();

    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessages = error.details.map((detail) => detail.message);
      throw new ApiError(400, `Validation Failed: ${errorMessages.join(', ')}`, errorMessages);
    }

    if (source === 'query' || source === 'params') {
      for (const key in req[source]) delete req[source][key];
      Object.assign(req[source], value);
    } else {
      req[source] = value;
    }
    next();
  };
};

module.exports = validate;
