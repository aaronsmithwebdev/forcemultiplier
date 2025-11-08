export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Settings</h1>
      <p className="text-sm text-slate-400">
        This page is a placeholder for future enhancements like configuring automatic sync schedules,
        mapping custom fields, or connecting other CRMs. For now, use it as a checklist for next steps in
        your project.
      </p>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-300">
        <li>Use NextAuth.js to gate access with Supabase email logins.</li>
        <li>Schedule background syncs with a cron job or Supabase Edge Function.</li>
        <li>Add custom field mapping so non-standard reports work out of the box.</li>
        <li>Show sync history with error details.</li>
      </ul>
    </div>
  );
}
