import { ArrowUpRight, InfoIcon } from "lucide-react";
import Link from "next/link";

export function SmtpMessage() {
  return (
    <div className="flex max-w-[400px] gap-4 rounded-md border border-border bg-muted/50 px-5 py-3">
      <InfoIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <small className="text-sm text-muted-foreground">
          <strong> Note:</strong> Emails are rate limited. Enable Custom SMTP to
          increase the rate limit.
        </small>
        <div>
          <Link
            href="https://supabase.com/docs/guides/auth/auth-smtp"
            target="_blank"
            className="flex items-center gap-1 text-sm text-primary underline underline-offset-4"
          >
            Learn more <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
