export function fieldError(
  issues: { path: string; message: string }[] | undefined,
  path: string,
): string | undefined {
  return issues?.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;
}

export function ErrorBox({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="error-box" role="alert">
      {message}
    </p>
  );
}
