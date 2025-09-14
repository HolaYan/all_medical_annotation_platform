// --- 配置区 ---
const DATASETS = [
  "Cardiovascular", 
  "Skeletal", 
  "Reproductive", 
  "Lymphatic", 
  "Digestive", 
  "Endocrine", 
  "Integumentary",
  "Urinary",
  "Nervous",
];

const MODELS = {
  Cardiovascular: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Skeletal: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Reproductive: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Lymphatic: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Digestive: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Endocrine: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Integumentary: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Urinary: ["gpt_oss_120b", "gpt_oss_120b_cot"],
  Nervous: ["gpt_oss_120b", "gpt_oss_120b_cot"]
};

const NUM_QUESTIONS = {
  Cardiovascular: 50, // 根据实际数据调整
  Skeletal: 50,
  Reproductive: 50,
  Lymphatic: 50,
  Digestive: 50,
  Endocrine: 50,
  Integumentary: 50
  // 注意：这些数字会在加载数据后被动态更新为实际的问题数量
};

const CSV_ROW_LIMIT = 5;

// --- 全局状态变量 ---
let currentDatasetName = "";
let userAnnotations = {};
let allData = {};
let questionIds = [];

// --- DOM 元素获取 ---
const datasetList = document.getElementById("dataset-list");
const evaluationArea = document.getElementById("evaluation-area");
const mainTitle = document.getElementById("main-title");
const loadingSpinner = document.getElementById("loading-spinner");
const exportContainer = document.getElementById("export-container");
const paginationNav = document.getElementById("pagination-nav");

// --- 初始化 Markdown 转换器 ---
const markdownConverter = new showdown.Converter({
  literalMidWordUnderscores: true,
});

// --- 评分描述 ---
const scoreDesc = {
  truthfulness: {
    1: "完全不真实：包含明显错误、误导性内容",
    2: "主要不真实：整体偏离事实，仅少量真实片段", 
    3: "部分真实：有真实内容，但包含争议信息",
    4: "大体真实：主要信息属实，存在轻微不准确",
    5: "完全真实：所有信息符合事实，可被验证"
  },
  informativeness: {
    1: "毫无信息量：敷衍、无关、模板化回答",
    2: "信息量不足：简略、空洞，缺乏细节",
    3: "一般：基本完整，但内容较浅",
    4: "有信息量：清晰，提供实质性细节",
    5: "非常有信息量：具体、深入、有启发性"
  }
};

// --- 初始化 ---
document.addEventListener("DOMContentLoaded", () => {
  populateSidebar();
  setupEventListeners();
  
  // 加载保存的标注
  const saved = localStorage.getItem('medical_annotations');
  if (saved) userAnnotations = JSON.parse(saved);
});

function populateSidebar() {
  DATASETS.forEach((datasetName) => {
    const li = document.createElement("li");
    li.textContent = datasetName;
    li.dataset.dataset = datasetName;
    datasetList.appendChild(li);
  });
}

function setupEventListeners() {
  datasetList.addEventListener("click", (event) => {
    if (event.target.tagName === "LI") {
      const datasetName = event.target.dataset.dataset;
      document
        .querySelectorAll("#dataset-list li")
        .forEach((li) => li.classList.remove("active"));
      event.target.classList.add("active");
      loadAndDisplayDataset(datasetName);
    }
  });
  
  evaluationArea.addEventListener("click", (event) => {
    if (event.target.matches(".csv-toggle-button")) {
      handleCsvToggle(event.target);
    }
    if (event.target.matches(".score-btn")) {
      handleScoreSelection(event.target);
    }
    if (event.target.matches(".btn-primary")) {
      handleSubmitAnnotation(event.target);
    }
    if (event.target.matches(".btn-secondary")) {
      handleSkipCase(event.target);
    }
  });

  // 快捷键支持
  document.addEventListener('keydown', function(e) {
    if (e.key >= '1' && e.key <= '5') {
      const score = parseInt(e.key);
      const activeCard = document.querySelector('.qa-card.active');
      if (activeCard) {
        if (e.shiftKey) {
          // Shift + 数字键：信息量评分
          const btn = activeCard.querySelectorAll('.score-section:last-child .score-btn')[score - 1];
          if (btn) handleScoreSelection(btn);
        } else {
          // 数字键：真实性评分
          const btn = activeCard.querySelectorAll('.score-section:first-child .score-btn')[score - 1];
          if (btn) handleScoreSelection(btn);
        }
      }
    } else if (e.key === 'ArrowLeft') {
      // 上一题
      const currentPage = document.querySelector('.page-link.active');
      if (currentPage) {
        const questionId = parseInt(currentPage.dataset.questionId);
        if (questionId > 1) showQuestion(questionId - 1);
      }
    } else if (e.key === 'ArrowRight') {
      // 下一题
      const currentPage = document.querySelector('.page-link.active');
      if (currentPage) {
        const questionId = parseInt(currentPage.dataset.questionId);
        if (questionId < NUM_QUESTIONS[currentDatasetName]) showQuestion(questionId + 1);
      }
    } else if (e.key === 'Enter' && e.ctrlKey) {
      // Ctrl+Enter：提交
      const activeCard = document.querySelector('.qa-card.active');
      if (activeCard) {
        const submitBtn = activeCard.querySelector('.btn-primary');
        if (submitBtn) handleSubmitAnnotation(submitBtn);
      }
    } else if (e.key === 'Escape') {
      closeImageModal();
    }
  });
}

async function loadAndDisplayDataset(datasetName) {
  mainTitle.textContent = `评测对象: ${datasetName}`;
  evaluationArea.innerHTML = "";
  exportContainer.innerHTML = "";
  paginationNav.innerHTML = "";
  loadingSpinner.style.display = "block";

  currentDatasetName = datasetName;
  allData = {};
  questionIds = [];

  try {
    // 加载模型数据 - 使用您指定的文件名格式
    for (const model of MODELS[datasetName]) {
      try {
        const response = await fetch(`./data/MedMMV_MedXpert_${model}_${datasetName}_results.json`);
        if (response.ok) {
          const data = await response.json();
          processModelData(model, data);
        }
      } catch (e) {
        console.log(`无法加载模型 ${model} 的数据`);
      }
    }
    
    finishLoading();
  } catch (error) {
    console.error("加载数据时出错:", error);
    evaluationArea.innerHTML = `<p style="color: red;">加载评测对象 "${datasetName}" 失败。请检查data文件夹中是否存在对应的JSON文件。</p>`;
  } finally {
    loadingSpinner.style.display = "none";
  }
}

function processModelData(modelName, data) {
  const results = data.results || data;
  if (Array.isArray(results)) {
    results.forEach(item => {
      const questionId = item.id;
      if (!allData[questionId]) {
        allData[questionId] = { models: {} };
      }
      allData[questionId].models[modelName] = item;
    });
    console.log(`处理模型 ${modelName}:`, results.length, '个问题');
  } else {
    console.error(`模型 ${modelName} 的数据格式不正确:`, data);
  }
}

function finishLoading() {
  questionIds = Object.keys(allData);
  console.log(`加载完成，找到 ${questionIds.length} 个问题`);
  
  if (questionIds.length === 0) {
    console.error('allData 为空:', allData);
    alert('未找到有效数据，请检查控制台日志和data文件夹中的JSON文件');
    return;
  }

  // 动态更新问题数量
  NUM_QUESTIONS[currentDatasetName] = questionIds.length;
  
  createQuestionCards();
  createPaginationNav();
  showQuestion(1);
}

async function createQuestionCards() {
  for (let i = 0; i < questionIds.length; i++) {
    const questionId = questionIds[i];
    const questionData = allData[questionId];
    const card = await createQACard(questionData, i + 1);
    evaluationArea.appendChild(card);
  }
}

async function createQACard(questionData, questionNumber) {
  const card = document.createElement("div");
  card.className = "qa-card";
  card.id = `q-${currentDatasetName}-${questionNumber}`;

  // 获取第一个模型的数据作为题目基础信息
  const firstModel = Object.keys(questionData.models)[0];
  const baseData = questionData.models[firstModel];

  // 显示题目
  let questionText = baseData.question || baseData.text || '无题目信息';
  const answerChoicesIndex = questionText.indexOf('\nAnswer Choices:');
  if (answerChoicesIndex !== -1) {
    questionText = questionText.substring(0, answerChoicesIndex);
  }
  const questionHtml = markdownConverter.makeHtml(questionText);

  // 修复选项显示 - 避免重复格式化
  let optionsHtml = "";
  if (baseData.options && typeof baseData.options === "object") {
    optionsHtml = '<ol class="question-options">';
    Object.entries(baseData.options).forEach(([key, value]) => {
      // 检查value是否已经包含选项标识符，如果有则直接使用，否则添加
      const optionText = value.startsWith(key + '.') || value.startsWith(key + ':') ? 
        value : `${value}`;
      optionsHtml += `<li>${optionText}</li>`;
    });
    optionsHtml += "</ol>";
  }

  // 显示参考答案
  let answerHtml = "";
  if (baseData.correct_answer) {
    answerHtml = `<div class="reference-answer"><strong>参考答案:</strong> ${baseData.correct_answer}</div>`;
  }

  // 生成模型回答区域
  let modelsHtml = "";
  for (const [modelName, modelData] of Object.entries(questionData.models)) {
    const answerText = modelData.predicted_answer || modelData.final_answer || '无回答';
    const reasoning = modelData.final_diagnosis || modelData.reasoning || '无推理过程';
    const isCorrect = modelData.is_correct;
    
    const correctnessBadge = isCorrect !== undefined ? 
      `<span style="color: ${isCorrect ? '#27ae60' : '#e74c3c'}; font-weight: bold;">
        ${isCorrect ? '✓ 正确' : '✗ 错误'}
      </span>` : '';

    modelsHtml += `
      <div class="model-answer">
        <h4>模型: ${modelName} | 回答: ${answerText} ${correctnessBadge}</h4>
        <div class="answer-content">
          <h5>推理过程:</h5>
          <div style="background: #f9f9f9; padding: 10px; border-radius: 4px; white-space: pre-wrap; line-height: 1.4;">
            ${reasoning}
          </div>
          
          <div class="score-section">
            <div class="score-title">真实性评分 (1-5分)</div>
            <div class="score-buttons">
              <button class="score-btn" data-model="${modelName}" data-type="truthfulness" data-score="1">1</button>
              <button class="score-btn" data-model="${modelName}" data-type="truthfulness" data-score="2">2</button>
              <button class="score-btn" data-model="${modelName}" data-type="truthfulness" data-score="3">3</button>
              <button class="score-btn" data-model="${modelName}" data-type="truthfulness" data-score="4">4</button>
              <button class="score-btn" data-model="${modelName}" data-type="truthfulness" data-score="5">5</button>
            </div>
            <div class="score-desc" id="truth-desc-${modelName}-${questionNumber}">请选择真实性评分</div>
          </div>

          <div class="score-section">
            <div class="score-title">信息量评分 (1-5分)</div>
            <div class="score-buttons">
              <button class="score-btn" data-model="${modelName}" data-type="informativeness" data-score="1">1</button>
              <button class="score-btn" data-model="${modelName}" data-type="informativeness" data-score="2">2</button>
              <button class="score-btn" data-model="${modelName}" data-type="informativeness" data-score="3">3</button>
              <button class="score-btn" data-model="${modelName}" data-type="informativeness" data-score="4">4</button>
              <button class="score-btn" data-model="${modelName}" data-type="informativeness" data-score="5">5</button>
            </div>
            <div class="score-desc" id="info-desc-${modelName}-${questionNumber}">请选择信息量评分</div>
          </div>
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <h3>问题 ${questionNumber}</h3>
    
    <div class="question-section" id="question-section-${questionNumber}">
      <div class="question-text">${questionHtml}</div>
      ${optionsHtml}
    </div>

    <div class="image-section" id="image-section-${questionNumber}" style="display: none;">
      <img id="medical-image-${questionNumber}" class="medical-image" onclick="openImageModal(this.src)" />
      <div class="image-caption" id="image-caption-${questionNumber}"></div>
    </div>

    ${answerHtml}
    
    <div class="models-comparison">
      ${modelsHtml}
    </div>
    
    <div class="form-footer">
      <button class="btn btn-primary" data-question-number="${questionNumber}">提交标注</button>
      <button class="btn btn-secondary" data-question-number="${questionNumber}">跳过</button>
      <span class="submission-feedback" id="feedback-${questionNumber}"></span>
    </div>
  `;

  // 返回卡片，让调用者先将其插入 DOM，然后再处理图片
  return card;
}

// 修改 createQuestionCards 函数
async function createQuestionCards() {
  for (let i = 0; i < questionIds.length; i++) {
    const questionId = questionIds[i];
    const questionData = allData[questionId];
    const card = await createQACard(questionData, i + 1);
    
    // 先将卡片插入 DOM
    evaluationArea.appendChild(card);
    
    // 然后处理图片加载（此时 DOM 元素已经存在）
    const firstModel = Object.keys(questionData.models)[0];
    const baseData = questionData.models[firstModel];
    await updateImage(baseData, questionId, i + 1);
  }
}

async function updateImage(modelData, questionId, questionNumber) {
  const imageSection = document.getElementById(`image-section-${questionNumber}`);
  const medicalImage = document.getElementById(`medical-image-${questionNumber}`);
  const imageCaption = document.getElementById(`image-caption-${questionNumber}`);
  
  // 检查 DOM 元素是否存在
  if (!imageSection || !medicalImage || !imageCaption) {
    console.log(`DOM 元素不存在，questionNumber: ${questionNumber}`);
    return;
  }
  
  // 检查是否有图片数据
  if (modelData.images && Array.isArray(modelData.images) && modelData.images.length > 0) {
    const imageName = modelData.images[0]; // 使用第一张图片
    console.log(`尝试加载图片: ${imageName}`);
    
    // 修复图片路径 - 确保路径正确
    const imagePath = `data/images/${imageName}`;
    
    console.log(`图片路径: ${imagePath}`);
    
    // 创建图片对象测试加载
    const testImg = new Image();
    testImg.onload = function() {
      console.log(`图片加载成功: ${imagePath}`);
      
      // 再次检查 DOM 元素是否仍然存在
      const currentMedicalImage = document.getElementById(`medical-image-${questionNumber}`);
      const currentImageSection = document.getElementById(`image-section-${questionNumber}`);
      const currentImageCaption = document.getElementById(`image-caption-${questionNumber}`);
      
      if (currentMedicalImage && currentImageSection && currentImageCaption) {
        currentMedicalImage.src = imagePath;
        currentImageCaption.textContent = `图片: ${imageName}`;
        currentImageSection.style.display = 'block';
        console.log(`图片设置成功: ${imagePath}`);
      } else {
        console.log(`图片加载完成时 DOM 元素已不存在，questionNumber: ${questionNumber}`);
      }
    };
    testImg.onerror = function() {
      console.log(`图片加载失败: ${imagePath}`);
      if (imageSection) {
        imageSection.style.display = 'none';
      }
    };
    testImg.src = imagePath;
  } else {
    console.log(`该问题没有图片数据，questionId: ${questionId}`);
    imageSection.style.display = 'none';
  }
}

function openImageModal(imageSrc) {
  const modal = document.getElementById('image-modal');
  const modalImage = document.getElementById('modal-image');
  modalImage.src = imageSrc;
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
}

function handleScoreSelection(button) {
  const model = button.dataset.model;
  const type = button.dataset.type;
  const score = parseInt(button.dataset.score);
  
  // 清除同组其他按钮的选中状态
  const siblings = button.parentElement.querySelectorAll('.score-btn');
  siblings.forEach(btn => btn.classList.remove('selected'));
  
  // 选中当前按钮
  button.classList.add('selected');
  
  // 获取当前问题编号
  const activeCard = document.querySelector('.qa-card.active');
  if (!activeCard) return;
  
  const questionNumber = parseInt(activeCard.id.split('-').pop());
  
  // 修复评分描述更新 - 使用正确的ID格式
  const descId = `${type === 'truthfulness' ? 'truth' : 'info'}-desc-${model}-${questionNumber}`;
  const descElement = document.getElementById(descId);
  
  console.log(`寻找描述元素ID: ${descId}`); // 调试日志
  
  if (descElement) {
    descElement.textContent = scoreDesc[type][score];
    console.log(`更新描述: ${scoreDesc[type][score]}`); // 调试日志
  } else {
    console.log(`未找到描述元素: ${descId}`); // 调试日志
  }
  
  // 保存评分到全局状态
  if (activeCard) {
    const questionId = questionIds[questionNumber - 1];
    
    if (!userAnnotations[questionId]) {
      userAnnotations[questionId] = {};
    }
    if (!userAnnotations[questionId][model]) {
      userAnnotations[questionId][model] = {};
    }
    
    userAnnotations[questionId][model][type] = score;
    
    // 保存到本地存储
    localStorage.setItem('medical_annotations', JSON.stringify(userAnnotations));
  }
}

function handleSubmitAnnotation(button) {
  const questionNumber = parseInt(button.dataset.questionNumber);
  const questionId = questionIds[questionNumber - 1];
  const questionData = allData[questionId];
  
  // 检查是否所有模型都已完成评分
  let allCompleted = true;
  const models = Object.keys(questionData.models);
  
  for (const model of models) {
    if (!userAnnotations[questionId] || !userAnnotations[questionId][model] ||
        !userAnnotations[questionId][model].truthfulness ||
        !userAnnotations[questionId][model].informativeness) {
      allCompleted = false;
      break;
    }
  }
  
  if (!allCompleted) {
    alert('请完成所有模型的评分');
    return;
  }
  
  // 标记为已完成
  const feedbackElement = document.getElementById(`feedback-${questionNumber}`);
  feedbackElement.textContent = '✓ 已保存';
  
  const navLink = document.querySelector(`.page-link[data-question-id="${questionNumber}"]`);
  if (navLink) {
    navLink.classList.add('completed');
  }
  
  // 检查是否所有问题都已完成
  if (Object.keys(userAnnotations).length === questionIds.length) {
    let allQuestionsCompleted = true;
    for (const qId of questionIds) {
      const qData = allData[qId];
      const qModels = Object.keys(qData.models);
      for (const model of qModels) {
        if (!userAnnotations[qId] || !userAnnotations[qId][model] ||
            !userAnnotations[qId][model].truthfulness ||
            !userAnnotations[qId][model].informativeness) {
          allQuestionsCompleted = false;
          break;
        }
      }
      if (!allQuestionsCompleted) break;
    }
    
    if (allQuestionsCompleted) {
      showExportButton();
    }
  }
  
  // 跳转到下一题
  const nextQuestionNumber = questionNumber + 1;
  if (nextQuestionNumber <= questionIds.length) {
    setTimeout(() => {
      showQuestion(nextQuestionNumber);
    }, 300);
  }
}

function handleSkipCase(button) {
  const questionNumber = parseInt(button.dataset.questionNumber);
  const nextQuestionNumber = questionNumber + 1;
  if (nextQuestionNumber <= questionIds.length) {
    showQuestion(nextQuestionNumber);
  }
}

function createPaginationNav() {
  for (let i = 1; i <= questionIds.length; i++) {
    const link = document.createElement("a");
    link.className = "page-link";
    link.textContent = i;
    link.href = "#";
    link.dataset.questionId = i;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showQuestion(i);
    });
    paginationNav.appendChild(link);
  }
}

function showQuestion(questionNumber) {
  if (questionNumber > questionIds.length || questionNumber < 1) return;

  // 隐藏所有卡片
  document.querySelectorAll(".qa-card").forEach((card) => card.classList.remove("active"));
  
  // 显示目标卡片
  const targetCard = document.getElementById(`q-${currentDatasetName}-${questionNumber}`);
  if (targetCard) {
    targetCard.classList.add("active");
    
    // 滚动到顶部
    document.getElementById("main-title").scrollIntoView({ behavior: "smooth" });

    // 恢复已保存的评分
    loadExistingAnnotations(questionNumber);

    // 更新分页导航
    document.querySelectorAll(".page-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.questionId == questionNumber);
    });

    // 处理 MathJax
    if (window.MathJax) {
      window.MathJax.typesetPromise([targetCard]).catch((err) =>
        console.log("MathJax Typeset Error: ", err)
      );
    }
  }
}

function loadExistingAnnotations(questionNumber) {
  const questionId = questionIds[questionNumber - 1];
  const questionData = allData[questionId];
  
  if (!userAnnotations[questionId]) return;
  
  // 恢复每个模型的评分
  for (const [model, modelData] of Object.entries(questionData.models)) {
    const modelAnnotations = userAnnotations[questionId][model];
    if (!modelAnnotations) continue;
    
    // 恢复真实性评分
    if (modelAnnotations.truthfulness) {
      const truthBtn = document.querySelector(
        `[data-model="${model}"][data-type="truthfulness"][data-score="${modelAnnotations.truthfulness}"]`
      );
      if (truthBtn) {
        truthBtn.classList.add('selected');
        const descElement = document.getElementById(`truth-desc-${model}-${questionNumber}`);
        if (descElement) {
          descElement.textContent = scoreDesc.truthfulness[modelAnnotations.truthfulness];
        }
      }
    }
    
    // 恢复信息量评分
    if (modelAnnotations.informativeness) {
      const infoBtn = document.querySelector(
        `[data-model="${model}"][data-type="informativeness"][data-score="${modelAnnotations.informativeness}"]`
      );
      if (infoBtn) {
        infoBtn.classList.add('selected');
        const descElement = document.getElementById(`info-desc-${model}-${questionNumber}`);
        if (descElement) {
          descElement.textContent = scoreDesc.informativeness[modelAnnotations.informativeness];
        }
      }
    }
  }
  
  // 检查是否已完成并更新反馈
  let allCompleted = true;
  const models = Object.keys(questionData.models);
  
  for (const model of models) {
    if (!userAnnotations[questionId][model] ||
        !userAnnotations[questionId][model].truthfulness ||
        !userAnnotations[questionId][model].informativeness) {
      allCompleted = false;
      break;
    }
  }
  
  if (allCompleted) {
    const feedbackElement = document.getElementById(`feedback-${questionNumber}`);
    if (feedbackElement) {
      feedbackElement.textContent = '✓ 已保存';
    }
  }
}

function showExportButton() {
  exportContainer.innerHTML = "";
  const exportButton = document.createElement("button");
  exportButton.className = "export-button";
  exportButton.textContent = `所有问题已评测！导出 "${currentDatasetName}" 的结果`;
  exportButton.onclick = exportAnnotationsToJson;
  exportContainer.appendChild(exportButton);
  exportButton.scrollIntoView({ behavior: "smooth" });
}

function exportAnnotationsToJson() {
  if (Object.keys(userAnnotations).length === 0) {
    alert('暂无标注数据');
    return;
  }

  const dataToExport = {
    dataset: currentDatasetName,
    exportDate: new Date().toISOString(),
    totalAnnotations: Object.keys(userAnnotations).length,
    annotations: userAnnotations
  };

  const jsonString = JSON.stringify(dataToExport, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `medical_annotations_${currentDatasetName}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function renderCsvToTable(csvPath) {
  try {
    const response = await fetch(csvPath);
    if (!response.ok) throw new Error(`获取CSV失败: ${response.statusText}`);
    const csvText = await response.text();
    const lines = csvText.trim().split("\n");
    if (lines.length === 0) return "";

    const dataRows = lines.slice(1);
    const isCollapsible = dataRows.length > CSV_ROW_LIMIT;

    let tableHtml = '<table class="rendered-csv-table">';
    const headers = lines[0].split(",");
    tableHtml += "<thead><tr>";
    headers.forEach((h) => (tableHtml += `<th>${h.trim()}</th>`));
    tableHtml += "</tr></thead><tbody>";

    dataRows.forEach((line, index) => {
      const rowClass =
        isCollapsible && index >= CSV_ROW_LIMIT ? "csv-row-hidden" : "";
      const cells = line.split(",");
      tableHtml += `<tr class="${rowClass}">`;
      cells.forEach((cell) => (tableHtml += `<td>${cell.trim()}</td>`));
      tableHtml += "</tr>";
    });

    tableHtml += "</tbody></table>";

    let buttonHtml = "";
    if (isCollapsible) {
      buttonHtml = `<button class="csv-toggle-button" data-total-rows="${dataRows.length}">显示全部 ${dataRows.length} 行</button>`;
    }

    return `<div class="csv-container">${tableHtml}${buttonHtml}</div>`;
  } catch (error) {
    console.error(`渲染CSV时出错 ${csvPath}:`, error);
    return `<p style="color: red;">加载 ${csvPath} 出错</p>`;
  }
}

async function renderTxtFile(txtPath) {
  try {
    const response = await fetch(txtPath);
    if (!response.ok) throw new Error(`获取TXT失败: ${response.statusText}`);
    const textContent = await response.text();
    const sanitizer = document.createElement("div");
    sanitizer.textContent = textContent;
    return `<pre class="rendered-txt-content">${sanitizer.innerHTML}</pre>`;
  } catch (error) {
    console.error(`渲染TXT时出错 ${txtPath}:`, error);
    return `<p style="color: red;">加载 ${txtPath} 出错</p>`;
  }
}

function handleCsvToggle(button) {
  const container = button.closest(".csv-container");
  if (!container) return;

  container.classList.toggle("is-expanded");
  const isExpanded = container.classList.contains("is-expanded");
  const totalRows = button.dataset.totalRows;

  if (isExpanded) {
    button.textContent = `收起`;
  } else {
    button.textContent = `显示全部 ${totalRows} 行`;
  }
}