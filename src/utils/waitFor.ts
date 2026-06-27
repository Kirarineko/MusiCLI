export function waitFor<T>(
  getter: () => T | null | undefined,
  timeout = 3000,
  interval = 20
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const value = getter();
      if (value != null) return resolve(value);
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(check, interval);
    };
    check();
  });
}
