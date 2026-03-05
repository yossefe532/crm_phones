# نشر النظام سحابياً

## نشر سريع على Render (الأسهل)
1. ادخل إلى Render ثم New + → Web Service.
2. اختر مستودع GitHub: `yossefe532/crm_phones`.
3. الإعدادات:
   - Runtime: Docker
   - Branch: `main`
   - Root Directory: اتركها فارغة
4. أضف Environment Variables:
   - `JWT_SECRET` = قيمة طويلة عشوائية
   - `DATABASE_URL` = `file:/var/data/dev.db`
5. من إعدادات الخدمة أضف Persistent Disk:
   - Mount Path: `/var/data`
   - Size: 1 GB أو أكثر
6. اضغط Deploy.

بعد نجاح النشر افتح رابط Render وسيعمل النظام كامل (واجهة + API).

## 1) تجهيز سيرفر سحابي
- أنشئ VPS عليه Ubuntu 22.04 أو أحدث.
- اربط دومينك بعنوان السيرفر (A Record).

## 2) تثبيت Docker و Docker Compose
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
```

## 3) رفع المشروع
```bash
git clone <YOUR_REPO_URL> crm-system
cd crm-system
```

## 4) إعداد متغيرات الإنتاج
```bash
cp .env.production.example .env
```

عدّل ملف `.env` بالقيم الفعلية:
- `JWT_SECRET` قيمة قوية وعشوائية.
- `CORS_ORIGIN` دومين الواجهة النهائي مثل `https://crm.yourdomain.com`.
- `APP_PORT` غالباً `80`.

## 5) تشغيل النظام
```bash
docker compose up -d --build
```

بعدها النظام يعمل على:
- `http://IP_OR_DOMAIN`

## 6) تحديث النظام لاحقاً
```bash
git pull
docker compose up -d --build
```

## 7) النسخ الاحتياطي للبيانات
قاعدة البيانات SQLite محفوظة في Docker volume باسم `crm_data`.

نسخة احتياطية:
```bash
docker run --rm -v crm-system_crm_data:/data -v $(pwd):/backup alpine sh -c "cp /data/dev.db /backup/dev.db.bak"
```

استرجاع:
```bash
docker run --rm -v crm-system_crm_data:/data -v $(pwd):/backup alpine sh -c "cp /backup/dev.db.bak /data/dev.db"
docker compose restart server
```
