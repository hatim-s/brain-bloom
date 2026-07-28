export type Message =
  | { success: string }
  | { error: string }
  | { message: string };

/**
 * Inline result of a form submission, rendered directly under the fields.
 *
 * Each state is a coloured rail rather than a filled banner: it reads at a
 * glance without turning the form into a warning box.
 */
export function FormMessage({ message }: { message: Message }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-2 text-sm">
      {"success" in message && (
        <div className="border-l-2 border-primary px-4 text-foreground">
          {message.success}
        </div>
      )}
      {"error" in message && (
        <div className="border-l-2 border-destructive px-4 text-destructive">
          {message.error}
        </div>
      )}
      {"message" in message && (
        <div className="border-l-2 border-border px-4 text-muted-foreground">
          {message.message}
        </div>
      )}
    </div>
  );
}
