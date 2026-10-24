"""Тесты сервера заявок: python -m unittest (или pytest) из папки server/."""
import importlib
import os
import unittest

ORIGIN = "https://example.github.io"


def payload(**changes):
    data = {
        "name": "Артём", "phone": "+7 (999) 123-45-67", "email": "", "telegram": "artem_test",
        "channel": "telegram", "when": "asap", "message": "Нужна площадка у метро",
        "website": "", "consent": True,
        "estimate": {
            "summary": "Корпоратив, 80 гостей, 4 часа, уровень «Комфорт»", "date": "19.12.2026",
            "low": 2050000, "high": 2600000, "total": 2280000,
            "vat": {"label": "НДС 22%", "low": 2500000, "high": 3150000},
            "lines": [{"title": "Питание", "sum": 640000}],
            "link": "https://example.github.io/smeta/?f=corporate#calc",
        },
    }
    data.update(changes)
    return data


class LeadApiTest(unittest.TestCase):
    def setUp(self):
        os.environ.update({"TELEGRAM_BOT_TOKEN": "test-token", "TELEGRAM_CHAT_ID": "123",
                           "ALLOWED_ORIGINS": ORIGIN, "RATE_LIMIT": "3"})
        import app as app_module
        self.mod = importlib.reload(app_module)
        self.sent = []
        self.mod.send_to_telegram = lambda text: self.sent.append(text) or True
        self.client = self.mod.app.test_client()

    def post(self, data, origin=ORIGIN):
        return self.client.post("/api/lead", json=data, headers={"Origin": origin})

    def test_lead_is_sent(self):
        r = self.post(payload())
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["ok"])
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], ORIGIN)
        text = self.sent[0]
        self.assertIn("Артём", text)
        self.assertIn("2 050 000 – 2 600 000 ₽", text)
        self.assertIn("@artem_test", text)
        self.assertIn("Согласие на обработку", text)

    def test_preflight(self):
        r = self.client.options("/api/lead", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r.headers["Access-Control-Allow-Methods"], "POST, OPTIONS")

    def test_validation(self):
        self.assertEqual(self.post(payload(name="")).status_code, 422)
        self.assertEqual(self.post(payload(phone="12")).status_code, 422)
        self.assertEqual(self.sent, [])

    def test_consent_required(self):
        self.assertEqual(self.post(payload(consent=False)).status_code, 422)

    def test_honeypot_is_ignored(self):
        r = self.post(payload(website="https://spam.example"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sent, [])

    def test_foreign_origin_rejected(self):
        self.assertEqual(self.post(payload(), origin="https://evil.example").status_code, 403)

    def test_rate_limit(self):
        codes = [self.post(payload()).status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])

    def test_html_is_escaped(self):
        self.post(payload(name="<b>Иван</b>", message="<script>alert(1)</script>"))
        self.assertIn("&lt;b&gt;Иван&lt;/b&gt;", self.sent[0])
        self.assertNotIn("<script>", self.sent[0])

    def test_bad_json(self):
        r = self.client.post("/api/lead", data="not json", headers={"Origin": ORIGIN, "Content-Type": "application/json"})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
