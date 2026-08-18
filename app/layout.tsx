import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"GDM Clinical Dashboard",description:"A clinician-focused gestational diabetes management prototype."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
