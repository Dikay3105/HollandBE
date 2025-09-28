import requests
from bs4 import BeautifulSoup
import json

url = "https://diemthi.tuyensinh247.com/danh-sach-truong-dai-hoc-cao-dang.html"
response = requests.get(url)
soup = BeautifulSoup(response.content, "html.parser")
schools = []
# Giả sử danh sách nằm trong thẻ <div> hoặc <table>
for school in soup.select("div.school-item"):  # Cần điều chỉnh selector theo cấu trúc trang
    if "TP.HCM" in school.text or "Hồ Chí Minh" in school.text:
        school_data = {
            "school_code": school.select_one(".school-code").text.strip(),
            "name": school.select_one(".school-name").text.strip(),
            "address": school.select_one(".school-address").text.strip(),
            "type": school.select_one(".school-type").text.strip(),
            "website": school.select_one("a")["href"] if school.select_one("a") else ""
        }
        schools.append(school_data)

# Lưu vào file JSON
with open("hcm_schools.json", "w", encoding="utf-8") as f:
    json.dump(schools, f, ensure_ascii=False, indent=2)