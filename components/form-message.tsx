type Message = { success: string } | { error: string } | { message: string };

/**
 * Inline result of a form submission, rendered directly under the fields.
 *
 * Each state is a coloured rail rather than a filled banner: the colour lands
 * on 2px of edge and, for an error, on the words — never on a red box that
 * would out-shout the form it belongs to. The rails share one geometry so the
 * three states read as one component in three moods.
 *
 * Errors announce themselves assertively because the submit the user just made
 * did not happen; the quieter states settle into the polite live region.
 */
function FormMessage({ message }: { message: Message }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-2 text-[0.8125rem] leading-[1.5]">
      {"success" in message && (
        <p
          className="border-l-2 border-primary py-0.5 pl-3 text-foreground"
          role="status"
        >
          {message.success}
        </p>
      )}
      {"error" in message && (
        <p
          className="border-l-2 border-destructive py-0.5 pl-3 text-destructive"
          role="alert"
        >
          {message.error}
        </p>
      )}
      {"message" in message && (
        <p
          className="border-l-2 border-border py-0.5 pl-3 text-muted-foreground"
          role="status"
        >
          {message.message}
        </p>
      )}
    </div>
  );
}

export { FormMessage, type Message };
