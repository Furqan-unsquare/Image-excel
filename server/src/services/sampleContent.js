// Demo questions used to show how a format will look before any real upload,
// in the format's own language.
const SAMPLES = {
  en: {
    meta: {},
    sections: [
      {
        title: 'Science',
        questions: [
          {
            number: '1',
            text: 'Fill in the blanks',
            marks: '2',
            items: [
              { label: '1', text: 'Plants make their own food by the process of ______ .' },
              { label: '2', text: '______ is the largest planet in our solar system.' },
            ],
          },
          {
            number: '2',
            text: 'Write True or False',
            marks: '2',
            items: [
              { label: '1', text: 'Water boils at 100 degree Celsius. ______' },
              { label: '2', text: 'The moon has its own light. ______' },
            ],
          },
          {
            number: '3',
            text: 'Classify the following',
            marks: '3',
            note: '( Cow, Rose, Eagle, Mango tree, Parrot, Grass )',
            table: { headers: ['Animals', 'Plants', 'Birds'], rows: [] },
          },
          {
            number: '4',
            text: 'Choose the correct option',
            marks: '1',
            items: [{ label: '1', text: 'Which organ helps us to breathe?', options: ['Heart', 'Lungs', 'Kidney'] }],
          },
          {
            number: '5',
            text: 'Answer in one sentence',
            marks: '2',
            items: [
              { label: '1', text: 'Why should we drink clean water?' },
              {
                label: '2',
                text: 'Name any two sources of light and explain how sunlight helps plants to grow in a garden or on a farm.',
              },
            ],
          },
        ],
      },
    ],
  },
  hi: {
    meta: { subject: 'हिंदी' },
    sections: [
      {
        title: '',
        questions: [
          {
            number: '1',
            text: 'रिक्त स्थान भरिए।',
            marks: '2',
            items: [
              { label: '1', text: 'सूरज ______ दिशा में उगता है।' },
              { label: '2', text: 'भारत की राजधानी ______ है।' },
            ],
          },
          {
            number: '2',
            text: 'सही या गलत लिखिए।',
            marks: '2',
            items: [
              { label: '1', text: 'मछली पानी के बिना जीवित रह सकती है।' },
              { label: '2', text: 'हमें बड़ों का आदर करना चाहिए।' },
            ],
          },
          {
            number: '3',
            text: 'सही विकल्प चुनकर लिखिए।',
            marks: '1',
            items: [{ label: 'अ', text: "'पानी' का पर्यायवाची शब्द है –", options: ['अग्नि', 'जल', 'पवन', 'आकाश'] }],
          },
          {
            number: '4',
            text: 'हल कीजिए।',
            marks: '2',
            items: [
              { label: '1', text: '3/4 + 1/8 =' },
              { label: '2', text: '25 × 4 =' },
            ],
          },
          {
            number: '5',
            text: 'निम्नलिखित प्रश्नों के उत्तर लिखिए।',
            marks: '2',
            items: [
              { label: '1', text: 'चिड़िया अपना घोंसला कहाँ बनाती है?' },
              { label: '2', text: 'वर्षा ऋतु में किसान क्या-क्या काम करते हैं? किन्हीं दो कामों के बारे में विस्तार से लिखिए।' },
            ],
          },
        ],
      },
    ],
  },
  mr: {
    meta: { subject: 'मराठी' },
    sections: [
      {
        title: '',
        questions: [
          {
            number: '1',
            text: 'रिकाम्या जागा भरा.',
            marks: '2',
            items: [
              { label: '1', text: 'महाराष्ट्राची राजधानी ______ आहे.' },
              { label: '2', text: 'गाय आपल्याला ______ देते.' },
            ],
          },
          {
            number: '2',
            text: 'चूक की बरोबर ते लिहा.',
            marks: '2',
            items: [
              { label: '1', text: 'कावळा पांढऱ्या रंगाचा असतो.' },
              { label: '2', text: 'सूर्य पूर्वेला उगवतो.' },
            ],
          },
          {
            number: '3',
            text: 'योग्य पर्याय निवडा.',
            marks: '1',
            items: [{ label: 'अ', text: "'पाणी' या शब्दाचा समानार्थी शब्द –", options: ['अग्नी', 'जल', 'वारा', 'आकाश'] }],
          },
          {
            number: '4',
            text: 'सोडवा.',
            marks: '2',
            items: [
              { label: '1', text: '3/4 + 1/8 =' },
              { label: '2', text: '25 × 4 =' },
            ],
          },
          {
            number: '5',
            text: 'खालील प्रश्नांची उत्तरे लिहा.',
            marks: '2',
            items: [
              { label: '1', text: 'चिमणी आपले घरटे कोठे बांधते?' },
              { label: '2', text: 'पावसाळ्यात शेतकरी कोणकोणती कामे करतात? कोणत्याही दोन कामांविषयी सविस्तर लिहा.' },
            ],
          },
        ],
      },
    ],
  },
};

export const SAMPLE_CONTENT = SAMPLES.en;

export const sampleContent = (language) => SAMPLES[language] || SAMPLES.en;
