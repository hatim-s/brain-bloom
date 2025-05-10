import { FloatingSidebar } from "@/components/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Typography } from "@/components/ui/typography";
import { fetchAllMindmaps } from "@/data/fetch-all-mindmaps";
import { PropsWithChildren } from "react";

export default async function MainAppLayout({ children }: PropsWithChildren) {
  const mindmaps = await fetchAllMindmaps();

  return (
    <>
      <FloatingSidebar mindmaps={mindmaps ?? []} />
      {children}
    </>
  );
}
