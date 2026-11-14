import { AuthForm } from "@/features/auth/auth-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <AuthForm mode="login" />
    </main>
  );
}
