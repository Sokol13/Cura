import type { FastifyBaseLogger } from 'fastify';
import type { WarningJournal } from './journal.js';

type Bindings = Parameters<FastifyBaseLogger['child']>[0];
type ChildLoggerOptions = Parameters<FastifyBaseLogger['child']>[1];

/** Capture warnings once while preserving the caller's logger and its children. */
export function withDiagnosticJournal(
  logger: FastifyBaseLogger,
  journal: WarningJournal,
  bindings: Bindings = {},
): FastifyBaseLogger {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(logger, {
    get(target, property) {
      if (methods.has(property)) return methods.get(property);
      let value: unknown;
      if (property === 'child') {
        value = (childBindings: Bindings, options?: ChildLoggerOptions) =>
          withDiagnosticJournal(target.child(childBindings, options), journal, {
            ...bindings,
            ...childBindings,
          });
      } else {
        const method: unknown = Reflect.get(target, property, target);
        if (typeof method !== 'function') return method;
        if (
          property === 'warn' ||
          property === 'error' ||
          property === 'fatal'
        ) {
          const level =
            property === 'warn' ? 40 : property === 'error' ? 50 : 60;
          value = (...args: unknown[]) => {
            const fields =
              args[0] && typeof args[0] === 'object' ? args[0] : {};
            journal.record({ ...bindings, ...fields, level, time: Date.now() });
            // Pino replaces level methods when its configured level changes.
            const current: unknown = Reflect.get(target, property, target);
            if (typeof current === 'function')
              Reflect.apply(current, target, args);
          };
        } else return method.bind(target);
      }
      methods.set(property, value);
      return value;
    },
  });
}
