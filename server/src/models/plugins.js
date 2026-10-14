/** Adds `id`, strips `__v`, and hides sensitive fields when serialising to JSON. */
export function jsonPlugin(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.password;
      delete ret.tokenVersion;
      return ret;
    },
  });
}
