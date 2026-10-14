/** Tiny bounded set used to remember ids of messages the bot itself sent. */
export class BoundedSet {
  constructor(max = 500) {
    this.max = max;
    this.set = new Set();
  }
  add(v) {
    this.set.delete(v);
    this.set.add(v);
    if (this.set.size > this.max) this.set.delete(this.set.values().next().value);
  }
  has(v) {
    return this.set.has(v);
  }
  get size() {
    return this.set.size;
  }
}
