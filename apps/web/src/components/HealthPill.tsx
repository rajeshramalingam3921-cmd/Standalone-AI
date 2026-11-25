import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, type HealthResult } from '../api';

type State = { kind: 'loading' } | HealthResult;

export function HealthPill() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const check = useCallback(() => {
    setState({ kind: 'loading' });
    void fetchHealth().then(setState);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((r) => active && setState(r));
    return () => {
      active = false;
    };
  }, []);

  const [tone, text] =
    state.kind === 'ok'
      ? ['done-ok', 'Server இயங்குகிறது']
      : state.kind === 'error'
        ? ['failed', state.message]
        : ['waiting', 'சரிபார்க்கிறது…'];

  return (
    <button
      type="button"
      className={`pill tone-${tone}`}
      onClick={check}
      aria-live="polite"
      title="மீண்டும் சரிபார்"
    >
      <span className="dot" aria-hidden="true" />
      {text}
    </button>
  );
}
