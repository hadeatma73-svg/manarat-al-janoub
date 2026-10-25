# منارة الجنوب — نظام إدارة المحل

موقع عربي (RTL) لإدارة محل غسيل سيارات وزيوت وبنشر: فواتير، مخزون، حجوزات، عملاء وولاء، مصروفات، موظفين وعمولات، تقارير.

- **الواجهة:** ملف `index.html` واحد (بدون أدوات بناء).
- **المزامنة:** Supabase (تسجيل دخول + جدول `shop_state` محمي بـ RLS + Realtime).
- **الاستضافة:** Netlify (`netlify.toml`).
- **قاعدة البيانات:** `supabase/migrations/001_shop_state.sql`.

## الرفع إلى GitHub
```bash
git init && git add . && git commit -m "Manarat Al Janoub"
git branch -M main
git remote add origin https://github.com/<USER>/manarat-al-janoub.git
git push -u origin main
```
بعدها في Netlify: Add new site → Import from Git → اختر الريبو (Publish directory = `.`).

> مفتاح Supabase الموجود في `index.html` هو المفتاح العام (publishable) ومحمي بسياسات RLS، ولا يوجد أي مفتاح سري في المشروع.

## تطبيق أندرويد (APK)
يُبنى تلقائياً عبر GitHub Actions (`.github/workflows/build-apk.yml`) باستخدام Capacitor:
1. ارفع المشروع إلى ريبو على فرع `main` (أو شغّل الـ workflow يدوياً من تبويب Actions).
2. بعد دقائق يظهر ملف `app-debug.apk` في **Releases** داخل الريبو. نزّله وثبّته على الجوال (فعّل «التثبيت من مصادر غير معروفة»).
- النسخة الموقّعة بمفتاح الإصدار (للنشر في Google Play) تحتاج إعداد مفتاح توقيع خاص بك.
- داخل التطبيق: واتساب والمزامنة والعمل بدون نت تعمل، أما تصدير CSV والطباعة فقد لا تعمل داخل WebView.
