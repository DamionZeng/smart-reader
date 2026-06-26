import { RegisterForm } from "@/components/auth/register-form";
import { SiteHeader } from "@/components/SiteHeader";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans">
      <SiteHeader />

      <main className="min-h-screen flex items-center justify-center px-6 py-32">
        <RegisterForm />
      </main>
    </div>
  );
}
