// Demo questions used to show how a format will look before any real upload.
export const SAMPLE_CONTENT = {
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
};
