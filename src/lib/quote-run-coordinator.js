export function createQuoteRunCoordinator() {
  let activeRun = null;

  return {
    start(controller) {
      if (activeRun || !controller) return false;
      activeRun = { controller, cancellable: true };
      return true;
    },

    requestCancellation(reason = 'USER_CANCELLED') {
      if (!activeRun) return { accepted: false, reason: 'NO_ACTIVE_QUOTE' };
      if (!activeRun.cancellable || activeRun.controller.signal.aborted) {
        return { accepted: false, reason: 'QUOTE_FINALIZING' };
      }

      activeRun.cancellable = false;
      activeRun.controller.abort(reason);
      return { accepted: true, reason };
    },

    markFinalizing(controller) {
      if (activeRun?.controller === controller) activeRun.cancellable = false;
    },

    finish(controller) {
      if (activeRun?.controller === controller) activeRun = null;
    },

    hasActiveQuote() {
      return Boolean(activeRun);
    }
  };
}
