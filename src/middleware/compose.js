/** Koa-style middleware composition. Each middleware is `(ctx, next) => Promise`. */
export function compose(middlewares) {
  return function run(ctx, last) {
    let index = -1;
    const dispatch = (i) => {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'));
      index = i;
      const fn = i === middlewares.length ? last : middlewares[i];
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    };
    return dispatch(0);
  };
}
