העדכון משדרג את המסלול הקיים ומוסיף את מעגל המשוב בזמן החופשה: לקוח מדווח או מבקש שינוי, והסוכן מקבל דוח ויכול להשיב ולעדכן את המסלול הרשמי.

**מצב ההפעלה:** הקוד והמיגרציה מוכנים ונבדקו. המיגרציה עדיין לא הופעלה ב־Supabase הפעיל. כל עוד השמירה אינה מחוברת, כפתורי לקוח אינם מוצגים כפעילים והסוכן מקבל הודעה מפורשת. לא בוצע מיזוג ל־main ולא שונו מסלולי לקוחות.

- תצוגת לקוח לטלפון בעברית ו־RTL עם ימים וכרטיסיות נפתחות; עורך ימים ופעילויות ושימור טקסט ישן ללא המרה אוטומטית.
- דיווחי בוצע, דילגנו ונדחה מבחינתנו, עם סיבה, עיכוב, הערה ודירוג לאחר ביצוע. ללא דיווח מוצג ״לא דווח״.
- דירוגי יום, חופשה ושירות; סיכום יום והעדפות למחר.
- בקשת שינוי נשמרת בנפרד מהמסלול. הסוכן יכול להציע חלופה, לדחות עם הסבר או לערוך ולאשר שינוי בפעולה אטומית ששומרת גם את המסלול הרשמי.
- דוחות משויכים לפעילות וליום: העברת פעילות למחר אינה מעבירה את הדיווח של היום, וגם סיכומי ימים שהוסרו נשארים זמינים.
- שמירה מעורך מיושן אינה דורסה שינוי שאושר בינתיים; טיוטות נשמרות במסך אחרי התנגשות או כשל שמירה.
- מזהי פעילות ויום יציבים נוצרים רק בשמירה יזומה או בהפעלת דיווחים מפורשת. אין שינוי נתונים בעת ביקור לקוח.
- ארבע טבלאות משוב עם RLS וחסימת גישה ישירה. RPC לקוח מוגבלים לקישור החופשה ולפעילות שלה; פעולות סוכן מוגבלות לבעלות מאומתת.
- קורא חופשה חדש עם רשימת שדות מפורשת, שפה וסטטוס, וחסימת טיוטות. מנגנון האימות ומסך הסיסמה נשמרו; ספריית Supabase קובעה לגרסה 2.119.0.

**בדיקות:** 71/71 בדיקות JavaScript ודפדפן עברו: 15 מודל, 21 שירות, 17 דפדפן בסיסיות ו־18 לתהליך המשוב. PostgreSQL 17 מקומי ומבודד עבר 76 בדיקות אבטחה ושמירה ושני תרחישי כשל מקדים אטומי. כל הבדיקות משתמשות בנתונים סינתטיים, ללא בדיקות על לקוחות אמיתיים.

[תוצאות מפורטות](https://github.com/perfectours832/perfect-tours-app/blob/codex/structured-itinerary-client/docs/VALIDATION.md) · [מיגרציה והוראות הפעלה](https://github.com/perfectours832/perfect-tours-app/blob/codex/structured-itinerary-client/docs/FEEDBACK-SETUP.md) · [בדיקות לפני פרסום](https://github.com/perfectours832/perfect-tours-app/blob/codex/structured-itinerary-client/docs/RELEASE-CHECKLIST.md)

**עדיין לא פעיל:** התקנת המיגרציה במערכת הפעילה; Push, SMS, תזכורות ושליחה אוטומטית; צבירה לפי ספק, מנויים, ריבוי סוכנויות וחנויות אפליקציות. נדרשת בדיקה פיזית באנדרואיד ובחופשת בדיקה מפורשת לאחר אישור ההפעלה.

**תמונות מבדיקות — נתונים סינתטיים בלבד**

[דיווח ודירוג פעילות](https://raw.githubusercontent.com/perfectours832/perfect-tours-app/codex/structured-itinerary-client/docs/screenshots/feedback-activity-android.png) · [דוח הסוכן ובקשות שינוי](https://raw.githubusercontent.com/perfectours832/perfect-tours-app/codex/structured-itinerary-client/docs/screenshots/feedback-agent-android.png) · [ממשק הלקוח המלא](https://raw.githubusercontent.com/perfectours832/perfect-tours-app/codex/structured-itinerary-client/docs/screenshots/feedback-client-android.png)

<details>
<summary>צילום דיווח ודירוג פעילות</summary>

![דיווח פעילות עם נתוני בדיקה](https://raw.githubusercontent.com/perfectours832/perfect-tours-app/codex/structured-itinerary-client/docs/screenshots/feedback-activity-android.png)

</details>

<details>
<summary>צילום דוח סוכן</summary>

![דוח סוכן עם נתוני בדיקה](https://raw.githubusercontent.com/perfectours832/perfect-tours-app/codex/structured-itinerary-client/docs/screenshots/feedback-agent-android.png)

</details>
