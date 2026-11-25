import type { WorkspaceInfo } from '@thiran/shared';
import { href } from '../router';

const TEXT: Record<Exclude<WorkspaceInfo['state'], 'ok'>, string> = {
  not_configured: 'இந்த project-க்கு folder இன்னும் அமைக்கப்படவில்லை.',
  not_allowed:
    'இந்த folder அனுமதிக்கப்பட்ட இடத்தில் இல்லை. Server கணினியின் .env-இல் WORKSPACE_ROOTS-இல் அதன் மேல் folder-ஐச் சேர்த்து server-ஐ மீண்டும் தொடங்கவும்.',
  missing: 'அமைக்கப்பட்ட folder server கணினியில் கிடைக்கவில்லை.',
};

export function WorkspaceNotice({
  projectId,
  state,
}: {
  projectId: string;
  state: WorkspaceInfo['state'];
}) {
  if (state === 'ok') return null;
  return (
    <section className="card notice" role="status">
      <p>{TEXT[state]}</p>
      <a href={href({ name: 'project', projectId, tab: 'settings' })}>Settings-க்குச் செல் →</a>
    </section>
  );
}
