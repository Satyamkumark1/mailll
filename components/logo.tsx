import { Icon } from "./icon";
import { cn } from "@/lib/utils";

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const large = size === "lg";
  return (
    <div className="flex items-center gap-sm select-none">
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-secondary text-on-secondary shadow-sm shadow-secondary/20",
          large ? "h-9 w-9" : "h-7 w-7"
        )}
      >
        <Icon name="check" className={cn("font-extrabold", large ? "text-[20px]" : "text-[16px]")} />
      </div>
      <span className={cn("font-bold tracking-tight text-on-surface", large ? "text-headline-md" : "text-body-lg")}>
        Email Validator Pro
      </span>
    </div>
  );
}
